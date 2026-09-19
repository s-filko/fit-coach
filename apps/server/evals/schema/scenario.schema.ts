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

const ScenarioPastSchema = z.object({
  user: FixtureUserSchema,
  plan: PlanSchema.optional(),
  workouts: z.array(WorkoutSchema).default([]),
  facts: z.array(FixtureFactSchema).default([]),
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
  /** Substrings the assembled model input must (not) contain — prompt blocks. */
  mustMatch: z.array(z.string().min(1)).optional(),
  mustNotMatch: z.array(z.string().min(1)).optional(),
  knownBug: KnownBugSchema.optional(),
});

const ToolsExpectSchema = z.object({
  must: z.array(z.string()).optional(),
  mustNot: z.array(z.string()).optional(),
  knownBug: KnownBugSchema.optional(),
});

const DeliveredExpectSchema = z.object({
  /** Substrings the delivered (user-visible) text must (not) contain. */
  mustMatch: z.array(z.string().min(1)).optional(),
  mustNotMatch: z.array(z.string().min(1)).optional(),
  knownBug: KnownBugSchema.optional(),
});

const PhaseAfterExpectSchema = z.object({
  phase: EvalPhaseSchema,
  knownBug: KnownBugSchema.optional(),
});

const PersistedExpectSchema = z.object({
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

/** One user turn: text in, run through the graph, expectations checked. */
const UserStepSchema = z.object({
  action: z.literal('user'),
  text: z.string().min(1),
  script: z.array(ScriptedMessageSchema).optional(),
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
