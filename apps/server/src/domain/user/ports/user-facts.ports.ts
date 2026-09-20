// User facts port — durable, cross-episode facts about a user.
//
// Facts are written ONLY at compaction, from the summariser's structured output
// (owner decision 2026-09-17, docs/STATE.md § "Blocked / waiting on owner"). There is
// no per-turn fact-writing tool and none may be added — see
// docs/superpowers/plans/refactor-p6-facts-and-progress-blocks.md Global Constraints.
//
// Table shape and FactCategory values are reused from ADR-0009; ADR-0009's per-turn
// passive-extraction *mechanism* is superseded (escalated to the owner in Task 13, not
// edited here).
//
// fact-lifecycle plan Task 1 (AC-FL-1): every fact carries a durability class with
// its dates and status (see `@domain/user/services/fact-lifecycle` for the bounds).
// Reads take the run's `now` as data — expired short facts and archived facts are
// never returned for the prompt or the constraint check; the caller passes the run
// clock (ctx.now), never the DB clock or a fresh `new Date()`.

/** ADR-0009's eight fact categories. */
export type FactCategory =
  | 'physical_constraint' // hard constraint — never override
  | 'exercise_preference' // soft preference — apply when choice exists
  | 'exercise_dislike' // motivational cue — acknowledge, do not avoid
  | 'physiological_pattern'
  | 'coaching_preference'
  | 'schedule_constraint'
  | 'equipment'
  | 'nutrition_preference';

/** `as const` tuple (not `readonly FactCategory[]`) so `z.enum(FACT_CATEGORIES)` infers the literal union. */
export const FACT_CATEGORIES = [
  'physical_constraint',
  'exercise_preference',
  'exercise_dislike',
  'physiological_pattern',
  'coaching_preference',
  'schedule_constraint',
  'equipment',
  'nutrition_preference',
] as const satisfies readonly FactCategory[];

// Lifecycle types re-exported from their owner module (single source: the bounds).
export type {
  FactArchivedReason,
  FactDurability,
  FactOnExpiry,
  FactStatus,
} from '@domain/user/services/fact-lifecycle';
import type {
  FactArchivedReason,
  FactDurability,
  FactOnExpiry,
  FactStatus,
} from '@domain/user/services/fact-lifecycle';

export interface UserFact {
  id: string;
  userId: string;
  category: FactCategory;
  fact: string;
  factKey: string;
  muscleGroup: string | null;
  confirmations: number;
  sourceTurnId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** AC-FL-1: the lifecycle columns — see `services/fact-lifecycle` for the class bounds. */
  durability: FactDurability;
  /** short only: hidden from the prompt once it passes (checked against the passed `now`). */
  expiresAt: Date | null;
  /** long_term only: when the coach should re-ask about this fact. */
  reviewAfter: Date | null;
  /** long_term: the phase note ("in a cast three weeks ago"). */
  phaseNote: string | null;
  /** When the current phase note was recorded. */
  phaseAt: Date | null;
  /** short only: forget silently, or ask once on expiry. */
  onExpiry: FactOnExpiry | null;
  status: FactStatus;
  archivedAt: Date | null;
  archivedReason: FactArchivedReason | null;
  /** Set when the user closed the fact ("it's fine now") — never re-asked after this (AC-FL-3). */
  closedByUserAt: Date | null;
  /** The fact this one superseded (AC-FL-3's "genuinely new statement" link). */
  supersedesId: string | null;
  /** A short "how we learned this". */
  context: string | null;
}

/** Input to an idempotent upsert — one fact extracted by the summariser. */
export interface UpsertFactInput {
  category: FactCategory;
  fact: string;
  muscleGroup?: string | null;
}

// --- DI Token ---

export const USER_FACTS_SERVICE_TOKEN = Symbol('UserFactsService');

// --- Service interface ---

export interface IUserFactsService {
  /**
   * Idempotent upsert of extracted facts (D-C): normalises each fact's text into a
   * `factKey`, and upserts on the unique (userId, category, factKey) index — a repeat
   * increments `confirmations` and `updatedAt` without rewriting `fact`. Returns the
   * number of rows written or confirmed.
   */
  upsertMany(userId: string, facts: UpsertFactInput[], sourceTurnId?: string): Promise<number>;

  /**
   * Facts for prompt rendering (block 2), ordered by category then recency, capped.
   * AC-FL-1: archived and expired facts are excluded — `now` is the run clock
   * (ctx.now), passed by the caller, never read from the DB or a fresh clock.
   */
  getForPrompt(userId: string, now: Date, cap?: number): Promise<UserFact[]>;

  /**
   * The `physical_constraint` subset with a non-null `muscleGroup` — hard-validation
   * input (D-G). AC-FL-1: archived and expired facts are excluded (`now` = run clock).
   */
  getConstraints(userId: string, now: Date): Promise<UserFact[]>;
}
