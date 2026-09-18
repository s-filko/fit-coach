/**
 * The single token estimator for the app and the eval stack: characters / 4,
 * times a 1.15 safety factor that covers Cyrillic-heavy text tokenising worse
 * than Latin. Master plan P2 item 3 fixes this formula.
 *
 * TOKEN_ESTIMATOR_ID is stamped into every BudgetReport: changing the formula
 * means changing the id.
 */
import { AIMessage, type BaseMessage } from '@langchain/core/messages';

const CHARS_PER_TOKEN = 4;
const SAFETY_FACTOR = 1.15;

export const TOKEN_ESTIMATOR_ID = 'chars4x1.15';

export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil((text.length / CHARS_PER_TOKEN) * SAFETY_FACTOR);
}

/**
 * Text a message contributes to an estimate: string content as is, array
 * content JSON-stringified, plus an AIMessage's tool calls. The budget
 * report and the BR-LLM-003 compaction trigger must measure the same
 * quantity, so the message-level basis lives here with the formula — one
 * definition for the reporting half and the enforcement half.
 */
export function messageTokenText(m: BaseMessage): string {
  const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  const toolCalls =
    m instanceof AIMessage && m.tool_calls && m.tool_calls.length > 0 ? JSON.stringify(m.tool_calls) : '';
  return `${content}${toolCalls}`;
}

/** Sum of message-level estimates — the `budgetReport` basis and the production `Estimate` for compaction. */
export function estimateMessages(messages: readonly BaseMessage[]): number {
  return messages.reduce((n, m) => n + estimateTokens(messageTokenText(m)), 0);
}
