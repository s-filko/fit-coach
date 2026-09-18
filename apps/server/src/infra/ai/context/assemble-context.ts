/**
 * The context assembler (ADR-0013 §3.4, D-03/D-H — refactor P2, reworked in
 * P4 Task 5, block 3 added in the context-budget plan Task 2, budget
 * enforcement added in Task 3): one function builds the message array every
 * phase sends to the model, in ONE fixed order for every phase — the phase
 * system prompt (block 1), the `## Previous episodes` block (block 2, when
 * summaries exist), the rendered domain context blocks (block 3, when any
 * render non-null), the interleaved episode history from the checkpointed
 * `messages` channel (block 4), and this run's current messages. Consecutive
 * system messages are sent as separate SystemMessages.
 *
 * Enforces INV-LLM-004 via `resolveBudget` (`./budget.ts`): block 1
 * (`systemPrompt`) is never trimmed or dropped; over-budget is resolved by
 * (a) trimming history, (b) stepping domain blocks down their `depths`
 * (largest first), (c) dropping the oldest episode summary, (d) the D-D
 * floor. `system` over its own budget is reported (`budgetReport`), never
 * cut — the caller (agent.node.ts) logs `warn`/`error` from the report.
 *
 * Otherwise pure (same discipline as BR-LLM-007 for prompts): no I/O, no
 * clock reads, no config reads, no logging — `now`/`timezone` arrive as
 * data. `async` only because `resolveBudget`'s `trimHistory` wraps
 * LangChain's `trimMessages`, which is `Promise`-typed.
 */
import { type BaseMessage, SystemMessage } from '@langchain/core/messages';

import type { StoredEpisodeSummary, TokenBudget } from '@domain/conversation/episode';
import type { BudgetReport } from '@domain/conversation/ports';
import type { User } from '@domain/user/services/user.service';

import { type ContextBlockCtx, EPISODE_SUMMARIES_V1, renderBlock } from '@infra/ai/prompts/blocks';
import { SECTION_SEPARATOR } from '@infra/ai/prompts/compose';

import { type BudgetBlockInput, resolveBudget } from './budget';
import { estimateMessages, estimateTokens, TOKEN_ESTIMATOR_ID } from './token-estimator';

export interface AssembleInput<D = unknown> {
  /** compose(PHASE.current.render(ctx)) — rendered by the caller (the spec owns the data). Never trimmed. */
  systemPrompt: string;
  /** state.episodeSummaries, oldest first — empty array renders no block. */
  episodeSummaries: StoredEpisodeSummary[];
  /**
   * ADR-0013 §3.4 block 3 (D-A/D-B) — the phase's declared blocks
   * (`spec.contextBlocks`), unrendered. Defaults to none.
   */
  contextBlocks?: ReadonlyArray<BudgetBlockInput<D>>;
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
    summaries: input.episodeSummaries,
    blocks: contextBlocks,
    data: input.blockData as D,
    blockCtx,
    history: input.history,
    current: input.current,
    budget: input.budget,
    estimate: estimateMessages,
  });

  const { summaries } = resolved;
  const summariesText =
    summaries.length > 0
      ? renderBlock(EPISODE_SUMMARIES_V1, { summaries, now: input.now, timezone: input.timezone })
      : null;

  // Block 3: render each block once at its resolved depth (full depth unless
  // resolveBudget stepped it down); a null render means the block is absent
  // this run. Reused for the joined SystemMessage, `domain` and `blocks`.
  // At the D-D floor only block 1 and `current` survive — block 3 goes too.
  const floored = resolved.cuts.includes('floor');
  const renderedBlocks = (floored ? [] : contextBlocks)
    .map(b => {
      const depth = resolved.blockDepths[b.id] ?? b.depths?.[0] ?? 0;
      const text = b.render(input.blockData as D, blockCtx, depth);
      return text === null ? null : { id: b.id, text, tokens: estimateTokens(text), depth };
    })
    .filter((b): b is { id: string; text: string; tokens: number; depth: number } => b !== null);
  const domainText = renderedBlocks.length > 0 ? renderedBlocks.map(b => b.text).join(SECTION_SEPARATOR) : null;

  const { history } = resolved;
  const [userMessage, ...inFlight] = input.current;
  const userText =
    userMessage !== undefined && isHuman(userMessage) && typeof userMessage.content === 'string'
      ? userMessage.content
      : '';

  // Fixed order, identical for every phase (ADR-0013 §3.4).
  const messages: BaseMessage[] = [
    new SystemMessage(input.systemPrompt),
    ...(summariesText ? [new SystemMessage(summariesText)] : []),
    ...(domainText ? [new SystemMessage(domainText)] : []),
    ...history,
    ...input.current,
  ];

  const domainTokens = renderedBlocks.reduce((n, b) => n + b.tokens, 0);

  const budgetReport: BudgetReport = {
    estimator: TOKEN_ESTIMATOR_ID,
    system: systemTokens,
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
    budgetReport.summary +
    budgetReport.domain +
    budgetReport.history +
    budgetReport.user +
    budgetReport.inFlight +
    budgetReport.toolResults;

  return { messages, budgetReport };
}
