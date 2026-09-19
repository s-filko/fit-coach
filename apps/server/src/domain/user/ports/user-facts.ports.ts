// User facts port — durable, cross-episode facts about a user.
//
// Facts are written ONLY at compaction, from the summariser's structured output
// (owner decision 2026-09-17, docs/STATE.md § "Blocked / waiting on owner"). There is
// no `remember_fact` tool and none may be added — see
// docs/superpowers/plans/refactor-p6-facts-and-progress-blocks.md Global Constraints.
//
// Table shape and FactCategory values are reused from ADR-0009; ADR-0009's per-turn
// passive-extraction *mechanism* is superseded (escalated to the owner in Task 13, not
// edited here).

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

export const FACT_CATEGORIES: readonly FactCategory[] = [
  'physical_constraint',
  'exercise_preference',
  'exercise_dislike',
  'physiological_pattern',
  'coaching_preference',
  'schedule_constraint',
  'equipment',
  'nutrition_preference',
];

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

  /** Facts for prompt rendering (block 2), ordered by category then recency, capped. */
  getForPrompt(userId: string, cap?: number): Promise<UserFact[]>;

  /** The `physical_constraint` subset with a non-null `muscleGroup` — hard-validation input (D-G). */
  getConstraints(userId: string): Promise<UserFact[]>;
}
