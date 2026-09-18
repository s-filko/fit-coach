import type { ConversationPhase } from '../phases';

/**
 * TranscriptPort (ADR-0013 §11, D-G): the append-only projection of every
 * message into `conversation_turns`. Its only reads belong to the legacy
 * import (`SummaryPort.latestLegacySummary`) — the prompt never reads this
 * port (INV-LLM-001).
 */
export const TRANSCRIPT_PORT_TOKEN = Symbol('TranscriptPort');

/**
 * LangChain-free domain union: one graph message as the transcript sees it.
 * The `BaseMessage` → `TranscriptMessage` mapping lives in infra (commit node).
 */
export type TranscriptMessage =
  | { kind: 'human'; text: string }
  | { kind: 'ai'; text: string; toolCalls?: Array<{ id: string; name: string; args: unknown }> }
  | { kind: 'tool_result'; toolCallId: string; text: string; status: 'ok' | 'error' };

export interface AppendRunMessagesInput {
  userId: string;
  runId: string;
  phase: ConversationPhase;
  /** The episode the run belongs to (D-O: the runId that started the episode). */
  episodeId: string;
  messages: TranscriptMessage[];
}

export interface TranscriptPort {
  /** Appends one row per message (plus one per tool call — D-K). Failure must not fail the reply (BR-CONV-007). */
  appendRunMessages(input: AppendRunMessagesInput): Promise<void>;
  /** Out-of-band note (clear-context, future app writes) — no run id. */
  appendSystemNote(input: { userId: string; phase: ConversationPhase; text: string }): Promise<void>;
}
