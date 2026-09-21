import { z } from 'zod';

import { EvalPhaseSchema, FixtureFactSchema, FixtureUserSchema, StateMessageSchema } from './case.schema';

/**
 * Scenario schema — training journeys shared by both eval layers
 * (docs/superpowers/plans/training-journey-scenarios.md, AC-TJ-1).
 *
 * A scenario is one TS module describing a whole training journey: a seeded
 * `past` (user, active plan, dated workouts, facts, checkpoint conversation)
 * plus ordered `steps` that drive the user turn by turn while the clock
 * advances. The deterministic layer (scripted model over the real test DB,
 * Task 2's runner) reads `script` and asserts everything in `expect`; the
 * live L3 layer ignores `script` and `seen` and reads tools from
 * `conversation_runs`. No runner logic lives here — this file is only the
 * format.
 */

/**
 * Relative time — an offset from T0, the moment the scenario starts running.
 *
 * Grammar: `<sign><magnitude><unit>`
 * - sign: `+` (future, clock advances between steps) or `-` (past, seeded
 *   events), mandatory — a bare `3d` is rejected so a missing sign can never
 *   silently mean "now".
 * - magnitude: one or more digits with an optional single fractional part
 *   (`3`, `3.5`).
 * - unit: `d` (days), `h` (hours) or `m` (minutes).
 *
 * Examples: `-3d`, `+6h`, `-14h`, `+3.5h`, `-30m`.
 */
export const RelativeTimeSchema = z.string().regex(/^[-+]\d+(?:\.\d+)?[dhm]$/);

export type RelativeTime = z.infer<typeof RelativeTimeSchema>;

const UNIT_MS: Record<'d' | 'h' | 'm', number> = { d: 86_400_000, h: 3_600_000, m: 60_000 };

/** Resolves a {@link RelativeTime} against T0. Exact to the millisecond. */
export function resolveRelativeTime(spec: string, t0: Date): Date {
  const match = /^([-+])(\d+(?:\.\d+)?)([dhm])$/.exec(spec);
  if (!match) {
    throw new Error(`Invalid relative time '${spec}' (grammar: <sign><magnitude><unit>, e.g. '-3d', '+6h', '+3.5h')`);
  }
  const [, sign, magnitude, unit] = match;
  const ms = UNIT_MS[unit as 'd' | 'h' | 'm'] * Number(magnitude);
  return new Date(t0.getTime() + (sign === '-' ? -ms : ms));
}

/**
 * Optional tag on any single `expect` assertion: the bug it reproduces, plus
 * the acceptance criterion that will close it (`BUG-018/AC-CC-1`). The
 * deterministic layer runs a tagged assertion as `test.failing` — it is
 * expected to fail today (owner rule: reproduction before fixes).
 */
const KnownBugSchema = z.string().regex(/^BUG-\d+(?:\/AC-(?:[A-Z]+-)?\d+)?$/);

/**
 * One entry of a `mustMatch`/`must` list (Task 4 Step 0): a bare string, or an
 * object tagging THAT single assertion with its bug. Per-entry granularity is
 * what a plane needs when its list mixes passing assertions with known-bug
 * ones (e.g. journey B's training step: WORKOUT OVERVIEW passes, the previous
 * turn verbatim is BUG-018/AC-CC-1) — one plane-level `knownBug` would drag
 * the passing assertions into `test.failing` with it.
 *
 * `liveOnly` (Task 5b) marks an expectation only the live L3 layer can check —
 * e.g. what a REAL model replies after a catch-up message. The deterministic
 * layer skips such entries: its `delivered` text is whatever the script
 * happened to say, so the entry would be vacuous there, not wrong. An object
 * needs at least one of `knownBug`/`liveOnly`; with neither, use a bare
 * string.
 */
export interface TaggedAssertion {
  text: string;
  knownBug?: string;
  /** Only the literal `true` marks an entry (the schema rejects `false`). */
  liveOnly?: true;
  /**
   * Fact-lifecycle journeys (AC-FL-7): the entry holds only when the course
   * check is ON — the directive block and the check's own input do not exist
   * when it is off. The deterministic layer skips it in the off run.
   */
  courseCheckOnly?: true;
}

export type ScenarioAssertion = string | TaggedAssertion;

const AssertionSchema = z.union([
  z.string().min(1),
  z
    .object({
      text: z.string().min(1),
      knownBug: KnownBugSchema.optional(),
      liveOnly: z.literal(true).optional(),
      courseCheckOnly: z.literal(true).optional(),
    })
    .refine(a => a.knownBug !== undefined || a.liveOnly !== undefined || a.courseCheckOnly !== undefined, {
      message: 'a tagged assertion needs knownBug, liveOnly, courseCheckOnly, or a combination',
    }),
]);

/** The substring a list entry asserts on, whichever form it takes. */
export const assertionText = (a: ScenarioAssertion): string => (typeof a === 'string' ? a : a.text);

/** The entry's knownBug tag, or null when absent (bare string or liveOnly-only). */
export const assertionKnownBug = (a: ScenarioAssertion): string | null =>
  typeof a === 'string' ? null : (a.knownBug ?? null);

/** True when the entry only holds with the course check ON (the off run skips it). */
export const assertionCourseCheckOnly = (a: ScenarioAssertion): boolean =>
  typeof a !== 'string' && a.courseCheckOnly === true;

/** True when only the live L3 layer checks this entry (deterministic skips it). */
export const assertionLiveOnly = (a: ScenarioAssertion): boolean => typeof a !== 'string' && a.liveOnly === true;

// --- past: the world a scenario starts from ---

/** One recorded set of a seeded workout. */
const WorkoutSetSchema = z.object({
  reps: z.number().int().positive(),
  weight: z.number().optional(),
  rpe: z.number().optional(),
});

const WorkoutExerciseSchema = z.object({
  /** Exercise name — the runner resolves it to an id (`ON CONFLICT` seeds). */
  exercise: z.string().min(1),
  sets: z.array(WorkoutSetSchema).default([]),
});

/**
 * A dated workout in the past. `at` is mandatory: the repository orders
 * history by `createdAt`, so a seed without an explicit timestamp lands at
 * "now" and every age-based assertion goes wrong.
 */
const WorkoutSchema = z.object({
  at: RelativeTimeSchema,
  /** `workout_sessions.sessionKey`, e.g. `upper_a` (`findLastCompletedByUserAndKey`). */
  key: z.string().min(1),
  exercises: z.array(WorkoutExerciseSchema).default([]),
});

/** One session of the active plan, keyed like the workouts reference it. */
const PlanSessionSchema = z.object({
  key: z.string().min(1),
  title: z.string().optional(),
  exercises: z
    .array(
      z.object({
        exercise: z.string().min(1),
        sets: z.number().int().positive(),
        /** `target_reps` is text in the DB — ranges like '8-10' are valid. */
        reps: z.string().optional(),
        weight: z.number().optional(),
      }),
    )
    .default([]),
});

const PlanSchema = z.object({
  name: z.string().min(1),
  sessions: z.array(PlanSessionSchema).default([]),
});

/**
 * A stored episode summary (`conversation_summaries`). The five lists mirror
 * `EpisodeSummary` (src/domain/conversation/episode.ts); only the fields a
 * journey asserts on are spelled out, the rest default to empty.
 */
const EpisodeSummarySeedSchema = z.object({
  at: RelativeTimeSchema,
  phaseAtEnd: EvalPhaseSchema,
  topics: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  userState: z.array(z.string()).default([]),
  trainingFeedback: z.array(z.string()).default([]),
  openItems: z.array(z.string()).default([]),
});

const ConversationPastSchema = z.object({
  messages: z.array(StateMessageSchema).default([]),
  summaries: z.array(EpisodeSummarySeedSchema).default([]),
  /** Drives the inactivity/gap logic — when the user last wrote (ISO in state). */
  lastUserMessageAt: RelativeTimeSchema.optional(),
});

/**
 * A seeded fact with its lifecycle (fact-lifecycle journeys, AC-FL-7). Without
 * `durability` it is what it always was — a permanent, explicitly stated
 * standing truth. With one, it goes through the REAL write path
 * (`rememberFact`) at the moment `at` (default: T0), so the code — not the
 * seed — computes `expires_at` / `review_after` from the class bounds:
 * `ttlDays` (short, 1–14) and `reviewInDays` (long_term, 14–182) count from `at`.
 * A fact seeded at `-20d` with `reviewInDays: 14` therefore has its review date
 * six days in the past at T0.
 */
export const ScenarioFactSchema = FixtureFactSchema.extend({
  durability: z.enum(['permanent', 'long_term', 'short']).optional(),
  /** When the fact was stated — the clock its dates count from; default T0. */
  at: RelativeTimeSchema.optional(),
  ttlDays: z.number().int().positive().optional(),
  reviewInDays: z.number().int().positive().optional(),
  phaseNote: z.string().optional(),
  onExpiry: z.enum(['forget', 'ask_once']).optional(),
});

export type ScenarioFact = z.infer<typeof ScenarioFactSchema>;

const ScenarioPastSchema = z.object({
  user: FixtureUserSchema,
  plan: PlanSchema.optional(),
  workouts: z.array(WorkoutSchema).default([]),
  facts: z.array(ScenarioFactSchema).default([]),
  conversation: ConversationPastSchema.optional(),
});

// --- steps ---

/**
 * One scripted model message (deterministic layer only; the live layer never
 * reads it). An AI message may carry text and one tool call together — e.g.
 * "Записал!" plus the `log_set` call — so both are optional, but not both
 * absent.
 */
const ScriptedMessageSchema = z
  .object({
    text: z.string().optional(),
    toolCall: z
      .object({
        name: z.string().min(1),
        args: z.record(z.string(), z.unknown()).default({}),
      })
      .optional(),
  })
  .refine(m => m.text !== undefined || m.toolCall !== undefined, {
    message: 'a scripted message needs text, a toolCall, or both',
  });

const SeenExpectSchema = z.object({
  /**
   * Substrings the assembled model input must (not) contain — prompt blocks.
   * A tagged entry fails today and runs as `test.failing` (per-assertion
   * granularity, Task 4 Step 0); the plane-level `knownBug` below stays valid
   * for scenarios authored before it.
   */
  mustMatch: z.array(AssertionSchema).optional(),
  mustNotMatch: z.array(AssertionSchema).optional(),
  knownBug: KnownBugSchema.optional(),
});

const ToolsExpectSchema = z.object({
  must: z.array(AssertionSchema).optional(),
  mustNot: z.array(AssertionSchema).optional(),
  knownBug: KnownBugSchema.optional(),
});

const DeliveredExpectSchema = z.object({
  /** Substrings the delivered (user-visible) text must (not) contain. */
  mustMatch: z.array(AssertionSchema).optional(),
  mustNotMatch: z.array(AssertionSchema).optional(),
  knownBug: KnownBugSchema.optional(),
});

const PhaseAfterExpectSchema = z.object({
  phase: EvalPhaseSchema,
  knownBug: KnownBugSchema.optional(),
});

/**
 * One expectation about the user's `user_facts` rows (AC-FL-7): the DATABASE
 * is the evidence, never the coach's prose — the 2026-09-21 dev smoke had the
 * coach announcing a retraction that never happened.
 *
 * `fact` is a substring identifying the rows (matched against the fact text,
 * archived rows included). `status` narrows them; exactly `count` (default 1)
 * must then remain, and every remaining row must satisfy every other field.
 * Dates are relative to T0 and compared within a 10-minute tolerance (the
 * scenario clock drifts with real time between steps); `null` means the column
 * must be null.
 */
export const FactRowExpectSchema = z.object({
  fact: z.string().min(1),
  status: z.enum(['active', 'archived']).optional(),
  count: z.number().int().nonnegative().optional(),
  archivedReason: z.enum(['user_closed', 'user_deleted', 'expired', 'superseded']).nullable().optional(),
  /** true = `closed_by_user_at` set, false = null. */
  closedByUser: z.boolean().optional(),
  durability: z.enum(['permanent', 'long_term', 'short']).optional(),
  onExpiry: z.enum(['forget', 'ask_once']).nullable().optional(),
  expiresAt: RelativeTimeSchema.nullable().optional(),
  reviewAfter: RelativeTimeSchema.nullable().optional(),
  phaseNote: z.string().nullable().optional(),
  confirmations: z.number().int().positive().optional(),
  /** true = `supersedes_id` set, false = null. */
  supersedes: z.boolean().optional(),
});

export type FactRowExpect = z.infer<typeof FactRowExpectSchema>;

/** One expectation about the user's `workout_plans` rows (journey (e): the plan is PERSISTED). */
export const PlanRowExpectSchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
  /** Names of exercises the persisted plan_json must contain (all of them). */
  exercises: z.array(z.string().min(1)).optional(),
});

export type PlanRowExpect = z.infer<typeof PlanRowExpectSchema>;

const PersistedExpectSchema = z.object({
  /** The user's `user_facts` rows after the step (AC-FL-7). */
  facts: z.array(FactRowExpectSchema).optional(),
  /** Substrings that must match NO row at all — a deleted fact leaves no trace. */
  factsAbsent: z.array(z.string().min(1)).optional(),
  /** Exactly this many `workout_plans` rows exist after the step, and (when given) match. */
  plans: z.array(PlanRowExpectSchema).optional(),
  /** Snapshot of the user's `workout_sessions` after the step. */
  session: z
    .object({
      key: z.string().optional(),
      status: z.enum(['planning', 'in_progress', 'completed', 'skipped']).optional(),
      hasStartedAt: z.boolean().optional(),
      hasCompletedAt: z.boolean().optional(),
      durationMinutes: z.number().nullable().optional(),
      exercises: z
        .array(
          z.object({
            exercise: z.string().min(1),
            /** Set order is asserted as written — in-order persistence matters. */
            sets: z.array(WorkoutSetSchema).default([]),
          }),
        )
        .optional(),
    })
    .optional(),
  /** A `conversation_turns` row exists for this step's run. */
  turnRecorded: z.boolean().optional(),
  knownBug: KnownBugSchema.optional(),
});

const StepExpectSchema = z.object({
  /** What the model SAW (assembled input) — deterministic layer only. */
  seen: SeenExpectSchema.optional(),
  tools: ToolsExpectSchema.optional(),
  phaseAfter: PhaseAfterExpectSchema.optional(),
  /** What the user was DELIVERED (final text of the run). */
  delivered: DeliveredExpectSchema.optional(),
  /** What got PERSISTED (DB snapshot after the step). */
  persisted: PersistedExpectSchema.optional(),
});

/** Moves the scenario clock forward (`+3.5h`) — no user turn, no run. */
const AdvanceStepSchema = z.object({
  action: z.literal('advance'),
  at: RelativeTimeSchema,
  expect: StepExpectSchema.optional(),
});

/**
 * The scripted STRUCTURED answers of a user step (deterministic layer only —
 * live never reads them). `courseCheck` answers the course-check call if it
 * fires this step (it is discarded when it does not, or when the check is
 * off); `summary` answers the episode summariser if compaction fires. Any
 * string may carry a `{{factId:<text substring>}}` placeholder, resolved to the
 * id of the user's fact containing that text at the moment the model answers.
 */
const StepStructuredSchema = z.object({
  courseCheck: z
    .object({
      vector: z.string().min(1),
      constraints: z.array(z.string()).default([]),
      questions: z.array(z.string()).default([]),
      /** One-shot check-ins about facts that just expired — shown in the run that asked, never stored. */
      expiryQuestions: z.array(z.string()).optional(),
      suspectFacts: z.array(z.string()).default([]),
      exerciseVerdicts: z.array(z.object({ exercise: z.string(), verdict: z.string() })).default([]),
    })
    .optional(),
  summary: z
    .object({
      topics: z.array(z.string()).default([]),
      decisions: z.array(z.string()).default([]),
      userState: z.array(z.string()).default([]),
      trainingFeedback: z.array(z.string()).default([]),
      openItems: z.array(z.string()).default([]),
      factOperations: z.array(z.record(z.string(), z.unknown())).default([]),
    })
    .optional(),
});

/** One user turn: text in, run through the graph, expectations checked. */
const UserStepSchema = z.object({
  action: z.literal('user'),
  text: z.string().min(1),
  script: z.array(ScriptedMessageSchema).optional(),
  structured: StepStructuredSchema.optional(),
  expect: StepExpectSchema.optional(),
});

export const ScenarioStepSchema = z.discriminatedUnion('action', [AdvanceStepSchema, UserStepSchema]);

export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;

export const ScenarioSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  past: ScenarioPastSchema,
  steps: z.array(ScenarioStepSchema).min(1),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
