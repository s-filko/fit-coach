/**
 * ToolOutcome serialisation v1 (ADR-0013 §4.4/§6): the ONE place that turns a
 * tool's return value into a ToolMessage. Tool-result strings are frozen per
 * tool — `ok.summary` is exactly the string the tool returned before P3;
 * `llm_error`/`system_error` render with the prefixes training.tools.ts used
 * to own (moved verbatim, decision D-C).
 */
import { ToolMessage } from '@langchain/core/messages';

import type { ToolErrorKind, ToolOutcome } from '@domain/conversation/tool-outcome';

/** Prefix for errors caused by incorrect LLM arguments (moved verbatim). */
export const LLM_ERROR_PREFIX = 'LLM_ERROR:';

/** Prefix for systemic errors no retry can fix (moved verbatim). */
export const SYSTEM_ERROR_PREFIX = 'SYSTEM_ERROR:';

/** Bump when the textual shape of tool results changes (requires a baseline re-freeze). */
export const TOOL_OUTCOME_FORMAT_ID = 'v1';

export function toToolMessage(outcome: ToolOutcome, toolCallId: string): ToolMessage {
  if (outcome.ok) {
    return new ToolMessage({ tool_call_id: toolCallId, content: outcome.summary, status: 'success' });
  }
  if (outcome.kind === 'user_error') {
    // The model relays the refusal to the user; not an error for the budget.
    const content = outcome.hint === undefined ? outcome.message : `${outcome.message} ${outcome.hint}`;
    return new ToolMessage({ tool_call_id: toolCallId, content, status: 'success' });
  }
  const prefix = outcome.kind === 'llm_error' ? LLM_ERROR_PREFIX : SYSTEM_ERROR_PREFIX;
  const base = `${prefix} ${outcome.message}`;
  const content = outcome.hint === undefined ? base : `${base} ${outcome.hint}`;
  return new ToolMessage({ tool_call_id: toolCallId, content, status: 'error' });
}

/**
 * Classifies a (possibly legacy) ToolMessage by prefix/status. Used by the
 * executor's error budget and by run records. `user_error` messages are
 * `success`-status by construction, so they classify as 'ok' — a relayed
 * refusal is not an error for the budget.
 */
export function outcomeKindOf(message: ToolMessage): 'ok' | ToolErrorKind {
  const content = typeof message.content === 'string' ? message.content : '';
  if (message.status === 'error') {
    if (content.startsWith(SYSTEM_ERROR_PREFIX)) {
      return 'system_error';
    }
    return 'llm_error';
  }
  return 'ok';
}
