import type { EpisodeSummary } from '../episode';
import type { ConversationPhase } from '../phases';

/**
 * SummaryPort (D-G): writes episode summaries and answers the one read this
 * plan needs — the legacy rolling summary a live thread imports once (D-E).
 * The prompt reads summaries from state, never from this port.
 */
export const SUMMARY_PORT_TOKEN = Symbol('SummaryPort');

export interface InsertSummaryInput {
  userId: string;
  runId: string;
  episodeId: string;
  phaseAtEnd: ConversationPhase;
  structured: EpisodeSummary;
  rendered: string;
}

export interface LegacySummary {
  text: string;
  phase: ConversationPhase;
  createdAt: Date;
}

export interface SummaryPort {
  /** Writes the `conversation_summaries` row and mirrors it to a summary turn row in one transaction. */
  insert(input: InsertSummaryInput): Promise<void>;
  /** Latest `role='summary'` turn row — the D-E import source for live threads. */
  latestLegacySummary(userId: string): Promise<LegacySummary | null>;
}
