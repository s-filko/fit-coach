// The course-check directive (course-check plan Task 1, AC-FL-5): the typed
// result of the course-check structured call (the owner's "сверка курса"). The model owns the judgement
// (what the course is, what to ask, what looks stale); the code owns when the
// call happens (events.ts) and how long the answer is trusted (fingerprint.ts).
import { z } from 'zod';

/** The schema name presented to the model in the structured-output request. */
export const COURSE_CHECK_DIRECTIVE_SCHEMA_NAME = 'course_check_directive_v1';

/**
 * The directive the check returns (all short English sentences — the coach
 * translates for the user, the directive itself is model-facing):
 * - `vector` — the current course, the stated goal in one line;
 * - `constraints` — the constraints in force right now;
 * - `questions` — what to ask now: review-date and expiry questions, plus the
 *   standing "how do you feel today" when one is due;
 * - `expiryQuestions` — one-shot check-ins about facts that just expired (see the schema);
 * - `suspectFacts` — facts the check suspects are stale (named, with why);
 * - `exerciseVerdicts` — verdicts on proposed exercises; usually empty — the
 *   check runs before the coach proposes, so there is rarely anything on trial.
 */
export const CourseCheckDirectiveSchema = z.object({
  vector: z.string().min(1),
  constraints: z.array(z.string()),
  questions: z.array(z.string()),
  /**
   * One-shot check-ins about facts that just EXPIRED (each `[EXPIRED — ask once now]`
   * fact in the input gets one here, NOT in `questions`). Rendered in the run that
   * asked and never stored: the fact is archived in that same run, so the question
   * belongs to it. Optional: absent = none.
   */
  expiryQuestions: z.array(z.string()).optional(),
  suspectFacts: z.array(z.string()),
  exerciseVerdicts: z.array(
    z.object({
      exercise: z.string().min(1),
      verdict: z.string().min(1),
    }),
  ),
});

export type CourseCheckDirective = z.infer<typeof CourseCheckDirectiveSchema>;

/** What persists in ConversationState — the directive plus its fingerprint and birth date. */
export interface StoredCourseDirective {
  /** courseCheckFingerprint of the inputs it was computed from — reuse while it holds. */
  fingerprint: string;
  directive: CourseCheckDirective;
  /** ISO — ctx.now of the generating run (observability only, never a predicate input). */
  generatedAt: string;
}

/**
 * The last FAILED attempt (call error or malformed answer) — persisted next to
 * the directive so a provider outage backs off instead of costing one failed
 * call per turn. The cooldown covers only this fingerprint: changed inputs are
 * a new question and may fire at once.
 */
export interface CourseCheckFailure {
  /** The fingerprint the attempt failed on. */
  fingerprint: string;
  /** ISO — ctx.now of the failing run (a predicate input, from the run clock). */
  at: string;
}
