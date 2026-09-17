import { z } from 'zod';

import type { ConversationPhase } from './phases';

/**
 * Episode memory types (ADR-0013 §3.3, D-C). One episode = a contiguous span
 * of `messages` ended by rule; `compact` turns it into one independent
 * structured summary — never merged with older ones (ADR-0010 rationale).
 */
export const EpisodeSummarySchema = z
  .object({
    topics: z.array(z.string()),
    decisions: z.array(z.string()),
    userState: z.array(z.string()),
    trainingFeedback: z.array(z.string()),
    openItems: z.array(z.string()),
  })
  .strict();

export type EpisodeSummary = z.infer<typeof EpisodeSummarySchema>;

/** What `episodeSummaries` state (max 3, oldest first) and the summary table row carry. */
export interface StoredEpisodeSummary {
  episodeId: string;
  phaseAtEnd: ConversationPhase;
  /** ISO timestamp of the compaction that ended the episode. */
  endedAt: string;
  summary: EpisodeSummary;
}

/** Why an episode ended (BR-LLM-001..003). Precedence: phase_boundary > inactivity > budget. */
export type CompactReason = 'inactivity' | 'phase_boundary' | 'budget';

/**
 * Per-phase token budget (ADR-0013 §3.4 table). P4 adds it as data and reads
 * only `history` for the BR-LLM-003 trigger; enforcement (trimming) is the
 * context-budget plan.
 */
export interface TokenBudget {
  system: number;
  longTerm: number;
  domain: number;
  history: number;
  outputReserve: number;
}
