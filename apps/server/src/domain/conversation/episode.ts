import { z } from 'zod';

import { FACT_CATEGORIES } from '@domain/user/ports';

import type { ConversationPhase } from './phases';

/**
 * Episode memory types (ADR-0013 §3.3, D-C). One episode = a contiguous span
 * of `messages` ended by rule; `compact` turns it into one independent
 * structured summary — never merged with older ones (ADR-0010 rationale).
 * The D-I invariant underneath: the adapter appends exactly one HumanMessage
 * per run and no node adds another — that is what makes "this run's
 * messages" findable by position in `infra/ai/graph/episode.ts`.
 *
 * `facts` (P6 Task 2, owner decision 2026-09-17): the summariser's structured
 * output is the ONLY source of durable user facts — there is no per-turn
 * fact-writing tool. Extraction into `user_facts` happens in the `compact` node (Task 3).
 * D-D: `StoredEpisodeSummary`'s rendering (`episodeParagraph`,
 * `episode-summaries.v1.ts`) names its five fields explicitly and does not read
 * `facts` — adding this field must not change what the user-visible
 * `## Previous episodes` block renders.
 */
export const EpisodeSummarySchema = z
  .object({
    topics: z.array(z.string()),
    decisions: z.array(z.string()),
    userState: z.array(z.string()),
    trainingFeedback: z.array(z.string()),
    openItems: z.array(z.string()),
    facts: z.array(
      z
        .object({
          category: z.enum(FACT_CATEGORIES),
          fact: z.string(),
          muscleGroup: z.string().optional(),
        })
        .strict(),
    ),
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
