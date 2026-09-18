/**
 * The context assembler (ADR-0013 §3.4, D-03/D-H — refactor P2, reworked in
 * P4 Task 5): one function builds the message array every phase sends to the
 * model, in ONE fixed order for every phase — the phase system prompt, the
 * `## Previous episodes` block (when summaries exist), the interleaved
 * episode history from the checkpointed `messages` channel, and this run's
 * current messages. Consecutive system messages are sent as separate
 * SystemMessages (§3.4 blocks 1–3).
 *
 * Pure (same discipline as BR-LLM-007 for prompts): no I/O, no clock reads,
 * no config reads, no logging. It counts and reports — no trimming, no
 * budgets (the context-budget plan).
 */
import { type BaseMessage, SystemMessage } from '@langchain/core/messages';

import type { StoredEpisodeSummary } from '@domain/conversation/episode';
import type { BudgetReport } from '@domain/conversation/ports';

import { EPISODE_SUMMARIES_V1, renderBlock } from '@infra/ai/prompts/blocks';

import { estimateMessages, estimateTokens, TOKEN_ESTIMATOR_ID } from './token-estimator';

export interface AssembleInput {
  /** compose(PHASE.current.render(ctx)) — rendered by the caller (the spec owns the data). */
  systemPrompt: string;
  /** state.episodeSummaries — empty array renders no block. */
  episodeSummaries: StoredEpisodeSummary[];
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

  const [userMessage, ...inFlight] = input.current;
  const userText =
    userMessage !== undefined && isHuman(userMessage) && typeof userMessage.content === 'string'
      ? userMessage.content
      : '';

  // Fixed order, identical for every phase (ADR-0013 §3.4).
  const messages: BaseMessage[] = [
    new SystemMessage(input.systemPrompt),
    ...(summariesText ? [new SystemMessage(summariesText)] : []),
    ...input.history,
    ...input.current,
  ];

  const budgetReport: BudgetReport = {
    estimator: TOKEN_ESTIMATOR_ID,
    system: estimateTokens(input.systemPrompt),
    summary: summariesText ? estimateTokens(summariesText) : 0,
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
    budgetReport.history +
    budgetReport.user +
    budgetReport.inFlight +
    budgetReport.toolResults;

  return { messages, budgetReport };
}
