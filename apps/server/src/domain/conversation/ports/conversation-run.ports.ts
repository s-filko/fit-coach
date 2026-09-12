import type { ConversationPhase } from './conversation-context.ports';

export type ConversationRunOutcome = 'ok' | 'llm_unavailable' | 'core_error' | 'budget_exhausted';

/** One recorded conversation run — ADR-0013 §8. */
export interface ConversationRunRecord {
  runId: string;
  userId: string;
  phaseIn: ConversationPhase;
  phaseOut: ConversationPhase | null;
  model: string;
  promptVersions: Record<string, string>;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  toolCalls: Array<{ name: string; argsHash: string; outcomeKind: string }> | null;
  transition: { toPhase: string; reason?: string } | null;
  outcome: ConversationRunOutcome;
}

export const CONVERSATION_RUN_SERVICE_TOKEN = Symbol('ConversationRunService');

export interface IConversationRunService {
  recordRun(record: ConversationRunRecord): Promise<void>;
}
