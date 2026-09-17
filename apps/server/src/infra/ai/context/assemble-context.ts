/**
 * The context assembler (ADR-0013 §3.4, D-03 — reporting half, refactor P2):
 * one function builds the message array every phase sends to the model, in
 * exactly today's per-phase order, and reports how many estimated tokens each
 * part costs. The layout comes from the caller's PhaseSpec (refactor-p3-phase-spec
 * Task 2) — no registry lookup here; consecutive system messages are sent as
 * separate SystemMessages (§3.4 blocks 1–3). The report travels to the persist
 * node via the run-metrics accumulator; the post-tool nudge is inserted later
 * by the shared agent node and is not part of the report (see BudgetReport's
 * JSDoc).
 *
 * Pure (same discipline as BR-LLM-007 for prompts): no I/O, no clock reads,
 * no config reads, no logging. It counts and reports — no trimming, no
 * budgets (P4).
 */
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

import type { ChatMsg } from '@domain/ai/types';
import type { BudgetReport } from '@domain/conversation/ports';

import type { PhaseLayout } from '@infra/ai/prompts';
import { HISTORY_FRAME_V1, renderBlock, SUMMARY_FRAME_V1 } from '@infra/ai/prompts/blocks';

import { estimateTokens, TOKEN_ESTIMATOR_ID } from './token-estimator';
import { renderToolResults } from './tool-results';

export interface AssembleInput {
  /** compose(PHASE.current.render(ctx)) — rendered by the caller (the spec owns the data). */
  systemPrompt: string;
  /** Ignored when the phase layout has no summary frame. */
  previousSummary?: string | null;
  /** contextService.getMessagesForPrompt(...) — the loaded transcript turns. */
  history: ChatMsg[];
  userMessage: string;
  /** This run's in-flight messages (state.messages ?? []) — AI tool calls and their results. */
  inFlight: BaseMessage[];
}

export interface AssembledContext {
  messages: BaseMessage[];
  budgetReport: BudgetReport;
}

/** The role-narrowing lambda from today's training.subgraph agentNode — one home on the assembly side. */
function toFrameRow(m: ChatMsg): { role: 'user' | 'assistant'; content: string } {
  return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content };
}

/** Text a message contributes to the report: string content as is, array content JSON-stringified, plus tool calls. */
function messageText(m: BaseMessage): string {
  const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  const toolCalls =
    m instanceof AIMessage && m.tool_calls && m.tool_calls.length > 0 ? JSON.stringify(m.tool_calls) : '';
  return `${content}${toolCalls}`;
}

function sumTokens(messages: readonly BaseMessage[]): number {
  return messages.reduce((n, m) => n + estimateTokens(messageText(m)), 0);
}

export function assembleContext(input: AssembleInput, layout: PhaseLayout): AssembledContext {
  const systemText = input.systemPrompt;
  const summaryText =
    layout.summaryFrame && input.previousSummary
      ? renderBlock(SUMMARY_FRAME_V1, { previousSummary: input.previousSummary })
      : null;

  // training frames history as one system block, rendered even when empty ("No prior conversation."
  // is today's text); every other phase interleaves the turns as human/ai messages.
  const historyFrameText =
    layout.historyMode === 'history_frame'
      ? renderBlock(HISTORY_FRAME_V1, { history: input.history.map(toFrameRow) })
      : null;
  const historyMessages: BaseMessage[] =
    layout.historyMode === 'interleaved'
      ? input.history.map(m => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)))
      : [new SystemMessage(historyFrameText as string)];

  const userMessage = new HumanMessage(input.userMessage);
  const inFlight = [...input.inFlight];
  const toolMessages = inFlight.filter((m): m is ToolMessage => m instanceof ToolMessage);
  const toolResultsText = layout.toolResultsFrame && toolMessages.length > 0 ? renderToolResults(toolMessages) : null;

  // Fixed order, identical to today's five agentNodes; runs are kept — the
  // model receives separate SystemMessages (ADR-0013 §3.4).
  const messages: BaseMessage[] = [
    new SystemMessage(systemText),
    ...(summaryText ? [new SystemMessage(summaryText)] : []),
    ...historyMessages,
    userMessage,
    ...inFlight,
    ...(toolResultsText ? [new SystemMessage(toolResultsText)] : []),
  ];

  const budgetReport: BudgetReport = {
    estimator: TOKEN_ESTIMATOR_ID,
    system: estimateTokens(systemText),
    summary: summaryText ? estimateTokens(summaryText) : 0,
    history: historyFrameText ? estimateTokens(historyFrameText) : sumTokens(historyMessages),
    user: estimateTokens(input.userMessage),
    inFlight: sumTokens(inFlight),
    toolResults: toolResultsText ? estimateTokens(toolResultsText) : 0,
    total: 0,
    // Counted on the returned (unmerged) array, before the post-tool nudge.
    messages: messages.length,
    historyTurns: input.history.length,
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
