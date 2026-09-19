/**
 * The context assembler (ADR-0013 §3.4, D-03/D-H — refactor P2, reworked in
 * P4 Task 5, block 3 added in the context-budget plan Task 2, budget
 * enforcement added in Task 3, `## User Facts` added in P6 Task 4): one
 * function builds the message array every phase sends to the model, in ONE
 * fixed order for every phase — the phase system prompt (block 1), the
 * `## User Facts` block (block 2a, when the user has facts — D-F, long-term
 * memory ahead of episode memory), the `## Previous episodes` block (block
 * 2b, when summaries exist), the rendered domain context blocks (block 3,
 * when any render non-null), the interleaved episode history from the
 * checkpointed `messages` channel (block 4), and this run's current
 * messages. Consecutive system messages are sent as separate SystemMessages.
 *
 * Enforces INV-LLM-004 via `resolveBudget` (`./budget.ts`, order extended by
 * P6 Task 4): block 1 (`systemPrompt`) is never trimmed or dropped;
 * over-budget is resolved by (0) truncating facts (lowest-confirmations
 * first, then oldest — a deliberate extension of the invariant's published
 * order, see `budget.ts`'s JSDoc), (a) trimming history, (b) stepping domain
 * blocks down their `depths` (largest first), (c) dropping the oldest
 * episode summary, (d) the D-D floor. `system` over its own budget is
 * reported (`budgetReport`), never cut — the caller (agent.node.ts) logs
 * `warn`/`error` from the report.
 *
 * Otherwise pure (same discipline as BR-LLM-007 for prompts): no I/O, no
 * clock reads, no config reads, no logging — `now`/`timezone` arrive as
 * data. `async` only because `resolveBudget`'s `trimHistory` wraps
 * LangChain's `trimMessages`, which is `Promise`-typed.
 */
import { type BaseMessage, SystemMessage } from '@langchain/core/messages';

import type { StoredEpisodeSummary, TokenBudget } from '@domain/conversation/episode';
import type { BudgetReport } from '@domain/conversation/ports';
import type { UserFact } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import {
  type ContextBlockCtx,
  EPISODE_SUMMARIES_V1,
  fullDepth,
  type RenderableBlock,
  renderBlock,
  renderBlocks,
  type RenderedBlock,
  USER_FACTS_V1,
} from '@infra/ai/prompts/blocks';
import { SECTION_SEPARATOR } from '@infra/ai/prompts/compose';

import { resolveBudget } from './budget';
import { estimateMessages, estimateTokens, TOKEN_ESTIMATOR_ID } from './token-estimator';

export interface AssembleInput<D = unknown> {
  /** compose(PHASE.current.render(ctx)) — rendered by the caller (the spec owns the data). Never trimmed. */
  systemPrompt: string;
  /** IUserFactsService.getForPrompt output, loaded once per run — empty array renders no block (D-F). */
  userFacts: UserFact[];
  /** state.episodeSummaries, oldest first — empty array renders no block. */
  episodeSummaries: StoredEpisodeSummary[];
  /**
   * ADR-0013 §3.4 block 3 (D-A/D-B) — the phase's declared blocks
   * (`spec.contextBlocks`), unrendered. Defaults to none.
   */
  contextBlocks?: ReadonlyArray<RenderableBlock<D>>;
  /** The data every block in `contextBlocks` reads — `loaded.data` from `PhaseSpec.loadContext`. */
  blockData?: D;
  /** The episode history from the checkpointed `messages` channel (INV-LLM-001). */
  history: BaseMessage[];
  /** This run: [HumanMessage, ...inFlight] — the assembler never splits it, even at the D-D floor. */
  current: BaseMessage[];
  /** PhaseSpec.budget (Task 1's table / LLM_BUDGET_* overrides). Enforced via resolveBudget. */
  budget: TokenBudget;
  now: Date;
  timezone: string | null;
  /** The block-render context's `user` (e.g. `training.client` reads firstName/fitnessGoal). */
  user: User | null;
}

export interface AssembledContext {
  messages: BaseMessage[];
  budgetReport: BudgetReport;
}

function isHuman(m: BaseMessage): boolean {
  return m._getType() === 'human';
}

export async function assembleContext<D>(input: AssembleInput<D>): Promise<AssembledContext> {
  const contextBlocks = input.contextBlocks ?? [];
  const blockCtx: ContextBlockCtx = { now: input.now, timezone: input.timezone, user: input.user };
  const systemTokens = estimateTokens(input.systemPrompt);

  const resolved = await resolveBudget<D>({
    systemTokens,
    facts: input.userFacts,
    summaries: input.episodeSummaries,
    blocks: contextBlocks,
    data: input.blockData as D,
    blockCtx,
    history: input.history,
    current: input.current,
    budget: input.budget,
    estimate: estimateMessages,
  });

  const { facts, summaries } = resolved;
  // Block 2a: `## User Facts` — long-term memory (D-F), rendered ahead of the
  // episode-summaries block (ADR-0013 §3.4: block 2's long-term slot precedes
  // episode memory). Empty facts render nothing, same contract as summaries.
  const userFactsText = facts.length > 0 ? renderBlock(USER_FACTS_V1, { facts }) : null;
  const summariesText =
    summaries.length > 0
      ? renderBlock(EPISODE_SUMMARIES_V1, { summaries, now: input.now, timezone: input.timezone })
      : null;

  // Block 3: render each block once at its resolved depth (full depth unless
  // resolveBudget stepped it down); a null render means the block is absent
  // this run. Reused for the joined SystemMessage, `domain` and `blocks`.
  // At the D-D floor only block 1 and `current` survive — block 3 goes too.
  const floored = resolved.cuts.includes('floor');
  const renderedBlocks: RenderedBlock[] = renderBlocks(
    floored ? [] : contextBlocks,
    input.blockData as D,
    blockCtx,
    b => resolved.blockDepths[b.id] ?? fullDepth(b),
  );
  const domainText = renderedBlocks.length > 0 ? renderedBlocks.map(b => b.text).join(SECTION_SEPARATOR) : null;

  const { history } = resolved;
  const [userMessage, ...inFlight] = input.current;
  const userText =
    userMessage !== undefined && isHuman(userMessage) && typeof userMessage.content === 'string'
      ? userMessage.content
      : '';

  // Fixed order, identical for every phase (ADR-0013 §3.4): block 1, block 2a
  // (facts, long-term memory), block 2b (episode summaries), block 3 (domain).
  const messages: BaseMessage[] = [
    new SystemMessage(input.systemPrompt),
    ...(userFactsText ? [new SystemMessage(userFactsText)] : []),
    ...(summariesText ? [new SystemMessage(summariesText)] : []),
    ...(domainText ? [new SystemMessage(domainText)] : []),
    ...history,
    ...input.current,
  ];

  const domainTokens = renderedBlocks.reduce((n, b) => n + b.tokens, 0);

  const budgetReport: BudgetReport = {
    estimator: TOKEN_ESTIMATOR_ID,
    system: systemTokens,
    longTerm: userFactsText ? estimateTokens(userFactsText) : 0,
    summary: summariesText ? estimateTokens(summariesText) : 0,
    domain: domainTokens,
    blocks: renderedBlocks.map(b => ({ id: b.id, tokens: b.tokens, depth: b.depth })),
    history: estimateMessages(history),
    user: estimateTokens(userText),
    inFlight: estimateMessages(inFlight),
    // Always 0 since P4 (D-H): the training tool-results block is gone; kept
    // for baseline comparability across the migration.
    toolResults: 0,
    total: 0,
    // Counted on the returned array, before the post-tool nudge.
    messages: messages.length,
    historyTurns: history.filter(isHuman).length,
    budget: input.budget,
    cuts: resolved.cuts,
  };
  budgetReport.total =
    budgetReport.system +
    budgetReport.longTerm +
    budgetReport.summary +
    budgetReport.domain +
    budgetReport.history +
    budgetReport.user +
    budgetReport.inFlight +
    budgetReport.toolResults;

  return { messages, budgetReport };
}
