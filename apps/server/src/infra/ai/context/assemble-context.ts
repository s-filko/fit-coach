/**
 * The context assembler (ADR-0013 §3.4, D-03/D-H — refactor P2, reworked in
 * P4 Task 5, block 3 added in the context-budget plan Task 2): one function
 * builds the message array every phase sends to the model, in ONE fixed
 * order for every phase — the phase system prompt (block 1), the `##
 * Previous episodes` block (block 2, when summaries exist), the rendered
 * domain context blocks (block 3, when any render non-null), the
 * interleaved episode history from the checkpointed `messages` channel
 * (block 4), and this run's current messages. Consecutive system messages
 * are sent as separate SystemMessages.
 *
 * Pure (same discipline as BR-LLM-007 for prompts): no I/O, no clock reads,
 * no config reads, no logging. It counts and reports — no trimming, no
 * budget enforcement (Task 3 of the context-budget plan). `blocks` arrives
 * already rendered (the agent node renders `spec.contextBlocks` at full
 * depth via `renderBlocks` from `context/blocks`) so this module stays
 * decoupled from the block renderer contract.
 */
import { type BaseMessage, SystemMessage } from '@langchain/core/messages';

import type { StoredEpisodeSummary } from '@domain/conversation/episode';
import type { BudgetReport } from '@domain/conversation/ports';

import { EPISODE_SUMMARIES_V1, renderBlock } from '@infra/ai/prompts/blocks';
import { SECTION_SEPARATOR } from '@infra/ai/prompts/compose';

import { estimateMessages, estimateTokens, TOKEN_ESTIMATOR_ID } from './token-estimator';

/** A block already rendered (agent.node.ts's `renderBlocks` output) — id/tokens/depth for the report, text to place. */
export interface AssembledBlock {
  id: string;
  text: string;
  tokens: number;
  depth: number;
}

export interface AssembleInput {
  /** compose(PHASE.current.render(ctx)) — rendered by the caller (the spec owns the data). */
  systemPrompt: string;
  /** state.episodeSummaries — empty array renders no block. */
  episodeSummaries: StoredEpisodeSummary[];
  /** ADR-0013 §3.4 block 3 (D-A/D-B) — already-rendered domain blocks, spec order. Defaults to none. */
  blocks?: AssembledBlock[];
  /** The episode history from the checkpointed `messages` channel (INV-LLM-001). */
  history: BaseMessage[];
  /** This run: [HumanMessage, ...inFlight] — the assembler never splits it. */
  current: BaseMessage[];
  now: Date;
  timezone: string | null;
}

export interface AssembledContext {
  messages: BaseMessage[];
  budgetReport: BudgetReport;
}

function isHuman(m: BaseMessage): boolean {
  return m._getType() === 'human';
}

export function assembleContext(input: AssembleInput): AssembledContext {
  const summariesText =
    input.episodeSummaries.length > 0
      ? renderBlock(EPISODE_SUMMARIES_V1, {
          summaries: input.episodeSummaries,
          now: input.now,
          timezone: input.timezone,
        })
      : null;

  const blocks = input.blocks ?? [];
  // Block 3: one SystemMessage of the non-null renders, spec order, joined the way compose() joins sections.
  const domainText = blocks.length > 0 ? blocks.map(b => b.text).join(SECTION_SEPARATOR) : null;

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
    ...input.history,
    ...input.current,
  ];

  const domainTokens = blocks.reduce((n, b) => n + b.tokens, 0);

  const budgetReport: BudgetReport = {
    estimator: TOKEN_ESTIMATOR_ID,
    system: estimateTokens(input.systemPrompt),
    summary: summariesText ? estimateTokens(summariesText) : 0,
    domain: domainTokens,
    blocks: blocks.map(b => ({ id: b.id, tokens: b.tokens, depth: b.depth })),
    history: estimateMessages(input.history),
    user: estimateTokens(userText),
    inFlight: estimateMessages(inFlight),
    // Always 0 since P4 (D-H): the training tool-results block is gone; kept
    // for baseline comparability across the migration.
    toolResults: 0,
    total: 0,
    // Counted on the returned array, before the post-tool nudge.
    messages: messages.length,
    historyTurns: input.history.filter(isHuman).length,
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
