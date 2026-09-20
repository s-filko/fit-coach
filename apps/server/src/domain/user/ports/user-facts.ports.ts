// User facts port — durable, cross-episode facts about a user.
//
// Facts are written at compaction (from the summariser's structured output,
// owner decision 2026-09-17) AND in conversation, through the `manage_fact` tool
// (fact-lifecycle plan Task 2, AC-FL-2) — the owner reversed the 2026-09-17
// no-per-turn-tool decision on 2026-09-20: "the user says something important
// now and it must stick now". The tool's writes go through the same lifecycle
// bounds (fact-lifecycle.ts) as any other writer.
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
export { FACT_DURABILITIES, FACT_ON_EXPIRY } from '@domain/user/services/fact-lifecycle';
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

/**
 * Input to a summariser `update` operation (AC-FL-4): the new statement that
 * supersedes a known active fact — the old row is archived (reason
 * `superseded`) and a NEW row is created linked via supersedes_id.
 */
export interface SupersedeFactInput {
  /** The active fact being superseded, verbatim from the summariser's known-facts list. */
  factId: string;
  category: FactCategory;
  fact: string;
  muscleGroup?: string | null;
  durability: FactDurability;
  /** The user stated irreversibility explicitly — opens the permanent gate. */
  explicitPermanent?: boolean;
  ttlDays?: number;
  reviewInDays?: number;
  phaseNote?: string | null;
  onExpiry?: FactOnExpiry;
  context?: string | null;
}

/**
 * Input to a conversational fact write (AC-FL-2): the model's judgement about
 * one fact's lifetime. The code-side bounds (clamping, the `permanent` gate)
 * are applied by `resolveLifecycle` — never restated here or in a tool.
 */
export interface RememberFactInput {
  category: FactCategory;
  fact: string;
  /**
   * When correcting a KNOWN fact: its id (from list_facts) — the row is updated
   * even though the corrected text normalises to a new key.
   */
  factId?: string;
  muscleGroup?: string | null;
  durability: FactDurability;
  /** short: days from `now` until expiry (clamped 1–14). */
  ttlDays?: number;
  /** long_term: days from `now` until the review date (clamped 14–182). */
  reviewInDays?: number;
  /** long_term: the phase note ("in a cast three weeks ago"). */
  phaseNote?: string | null;
  /** short: forget silently, or ask once on expiry. */
  onExpiry?: FactOnExpiry;
  /** A short "how we learned this". */
  context?: string | null;
  /** The user stated irreversibility explicitly — opens the permanent gate. */
  explicitPermanent?: boolean;
  /** A genuinely new statement replacing a CLOSED fact — linked via supersedes_id. */
  supersedesFactId?: string;
  /**
   * When this evidence was actually stated — the AC-FL-3 clock. Defaults to `now`
   * (a live conversation is its own evidence); the compaction path (Task 3) passes
   * the summarised turn's time so an OLD restatement cannot re-open a closed fact.
   * Only the closure comparison reads it — every date written uses `now`.
   */
  evidenceAt?: Date;
}

/** What a conversational write did — the tool reports each differently (AC-FL-2/AC-FL-3). */
export type RememberFactOutcome =
  | { outcome: 'created'; fact: UserFact }
  /** An active fact with the same key, corrected in place: text rewritten, confirmations bumped. */
  | { outcome: 'updated'; fact: UserFact }
  /**
   * Evidence older than the user's closure — nothing written (AC-FL-3). The closed
   * row is returned so the caller can see why; a NEWER statement never lands here —
   * it creates a new row linked via supersedes_id (`created`).
   */
  | { outcome: 'skipped_stale_evidence'; fact: UserFact };

/** The listing shape AC-FL-8 reviews from: active grouped by the caller, archived only when asked. */
export interface FactsListing {
  active: UserFact[];
  /** Empty unless the caller asked for the archived set. */
  archived: UserFact[];
}

// --- DI Token ---

export const USER_FACTS_SERVICE_TOKEN = Symbol('UserFactsService');

// --- Service interface ---

export interface IUserFactsService {
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

  // --- Conversational memory operations (fact-lifecycle Task 2, AC-FL-2/AC-FL-3/AC-FL-8) ---
  // All of these take the run clock (`now`) as data — never the DB clock.

  /**
   * Writes one fact from conversation: creates, corrects an active fact in place, or
   * re-opens a closed key from evidence NEWER than the closure — as a NEW row linked
   * via supersedes_id; the closed row is never un-archived (AC-FL-3, and wave B's
   * recurrence promotion counts exactly that archive). Older evidence (input.evidenceAt,
   * defaulting to `now`) is skipped. Bounds and the `permanent` gate are applied here
   * via `resolveLifecycle`; throws `PermanentFactRefusal` when the gate does not open.
   */
  rememberFact(
    userId: string,
    input: RememberFactInput,
    now: Date,
    /** Provenance: the summary turn the extraction came from (fact-lifecycle Task 1). */
    sourceTurnId?: string,
  ): Promise<RememberFactOutcome>;

  /**
   * A summariser `confirm` (AC-FL-4): bumps `confirmations` and `updatedAt` on the
   * ACTIVE row — the stored text is never rewritten (D-C). False when the id matches
   * no active fact of this user (already closed, deleted or invented — skip silently).
   */
  confirmFact(userId: string, factId: string, now: Date): Promise<boolean>;

  /**
   * A summariser `update` (AC-FL-4): archives the target row (reason `superseded`,
   * `archived_at` = `now`) and creates a NEW active row linked via supersedes_id —
   * the lifecycle bounds apply as in {@link rememberFact}. Null when the target is
   * missing; `skipped_stale_evidence` when the target is user-closed and the
   * evidence is not newer than that closure (a closed fact is never re-added, AC-FL-3).
   */
  supersedeFact(
    userId: string,
    input: SupersedeFactInput,
    evidenceAt: Date,
    now: Date,
    sourceTurnId?: string,
  ): Promise<RememberFactOutcome | null>;

  /**
   * Archives one fact — the user's "that's not true / it's fine now" (AC-FL-2, or the
   * summariser's `retract` op, AC-FL-4): the row, its history and its confirmation
   * counter stay; `closed_by_user_at` is set; it never renders and is never re-asked
   * (AC-FL-3). `evidenceAt` (default `now`) is WHEN the retraction was stated — the
   * summariser path passes the episode clock so the stale-evidence guard holds; a
   * short `reason` (the summariser's rationale) lands in `context`. Idempotent: an
   * already-archived fact returns unchanged. Null when the id matches no fact.
   */
  retractFact(
    userId: string,
    input: { factId: string; evidenceAt?: Date; reason?: string },
    now: Date,
  ): Promise<UserFact | null>;

  /**
   * Deletes one fact ENTIRELY — the user's "I don't want you storing that"
   * (AC-FL-8): no row, no trace, not even in the archived listing. A distinct
   * operation from {@link retractFact}; never a silent substitute. False when the
   * id matches no fact of this user.
   */
  deleteFact(userId: string, factId: string): Promise<boolean>;

  /**
   * Expiry, performed (course-check plan, expiry task): every ACTIVE short fact
   * whose TTL is up at `now` — both `on_expiry` kinds, still stored as active.
   * The one explicit "due" read: `getForPrompt` / `getConstraints` keep
   * excluding these rows, so the prompt and the hard guard are untouched. What
   * each one gets is `expiryAction` (fact-lifecycle.ts): a question then the
   * archive, or the silent archive.
   */
  getExpiredActive(userId: string, now: Date): Promise<UserFact[]>;

  /**
   * Archives one EXPIRED fact (`archived_reason: 'expired'`, `archived_at` =
   * `now`; `closed_by_user_at` stays null — the user did not say it). Guarded
   * in the write itself: only an active short fact whose TTL is up at `now` is
   * touched, so a fact re-stated (TTL renewed) or already archived is left
   * alone. Idempotent; false when nothing was archived.
   */
  archiveExpired(userId: string, factId: string, now: Date): Promise<boolean>;

  /**
   * The review listing (AC-FL-8): every active fact (expired excluded) plus the
   * archived set with its closure reasons, only when `includeArchived`.
   */
  listFacts(userId: string, includeArchived: boolean, now: Date): Promise<FactsListing>;
}
