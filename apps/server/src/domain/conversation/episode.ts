import { z } from 'zod';

import { FACT_CATEGORIES, FACT_DURABILITIES, FACT_ON_EXPIRY } from '@domain/user/ports';

import type { ConversationPhase } from './phases';

/**
 * Episode memory types (ADR-0013 §3.3, D-C). One episode = a contiguous span
 * of `messages` ended by rule; `compact` turns it into one independent
 * structured summary — never merged with older ones (ADR-0010 rationale).
 * The D-I invariant underneath: the adapter appends exactly one HumanMessage
 * per run and no node adds another — that is what makes "this run's
 * messages" findable by position in `infra/ai/graph/episode.ts`.
 *
 * `facts` (P6 Task 2, owner decision 2026-09-17; superseded by v4's
 * `factOperations` in the fact-lifecycle plan Task 3, AC-FL-4): durable facts
 * are written at compaction AND in conversation (`manage_fact`, fact-lifecycle
 * Task 2 — the 2026-09-17 no-per-turn-tool decision was reversed by the owner
 * on 2026-09-20). v3's blind upsert list became v4's operations below.
 * D-D: `StoredEpisodeSummary`'s rendering (`episodeParagraph`,
 * `episode-summaries.v1.ts`) names its five fields explicitly and reads
 * neither `facts` nor `factOperations` — adding these fields must not change
 * what the user-visible `## Previous episodes` block renders.
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

/**
 * One fact operation in the v4 summariser's structured output (AC-FL-4): the
 * summariser SEES the known active facts and says what to do with them, instead
 * of a blind upsert list. Flat on purpose — the same shape `manage_fact`'s
 * schema taught the provider family. `factId`s must be copied verbatim from the
 * known-facts list the prompt rendered; a made-up id is a schema rejection.
 */
export const FactOperationSchema = z
  .object({
    op: z.enum(['add', 'confirm', 'update', 'retract']),
    /** confirm / update / retract: the known fact's id, verbatim from the prompt. */
    factId: z.string().uuid().optional(),
    /** retract: why the episode shows the fact stopped being true. */
    reason: z.string().optional(),
    category: z.enum(FACT_CATEGORIES).optional(),
    fact: z.string().optional(),
    muscleGroup: z.string().optional(),
    durability: z.enum(FACT_DURABILITIES).optional(),
    ttlDays: z.number().int().optional(),
    reviewInDays: z.number().int().optional(),
    phaseNote: z.string().optional(),
    onExpiry: z.enum(FACT_ON_EXPIRY).optional(),
  })
  .strict();

export type FactOperation = z.infer<typeof FactOperationSchema>;

/**
 * Episode summariser v4's structured output: v3's five list fields, with
 * `factOperations` replacing `facts` (AC-FL-4). Empty is the expected common
 * answer — most episodes state nothing durable.
 */
export const EpisodeSummaryV4Schema = z
  .object({
    topics: z.array(z.string()),
    decisions: z.array(z.string()),
    userState: z.array(z.string()),
    trainingFeedback: z.array(z.string()),
    openItems: z.array(z.string()),
    factOperations: z.array(FactOperationSchema),
  })
  .strict();

export type EpisodeSummaryV4 = z.infer<typeof EpisodeSummaryV4Schema>;

/** What `episodeSummaries` state (max 3, oldest first) and the summary table row carry. */
export interface StoredEpisodeSummary {
  episodeId: string;
  phaseAtEnd: ConversationPhase;
  /** ISO timestamp of the compaction that ended the episode. */
  endedAt: string;
  /** v3 (legacy, `facts`) or v4 (`factOperations`) — renderers read only the five list fields. */
  summary: EpisodeSummary | EpisodeSummaryV4;
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
