/**
 * The course-check step (course-check plan Task 1, AC-FL-5): one extra
 * structured model call on the `course_check` profile, fired by event from
 * `prepare` — at most once per run, and on a normal turn not at all (the
 * fingerprint holds, the stored directive rides). The result persists in
 * ConversationState.courseDirective and renders as one prompt block until its
 * fingerprint changes.
 *
 * Failure discipline (the AC's "never blocks a reply"): a failed or malformed
 * call logs a warn and records the failed attempt (fingerprint + run time) —
 * the run continues exactly as it would without the layer, a previously stored
 * directive is NOT overwritten, and the same fingerprint is not re-attempted
 * until the cooldown passes (a provider outage gets quieter, not chattier;
 * changed inputs fire at once).
 * Degraded reads degrade to what is known: a failed facts load is an empty
 * list, a failed plan load is "no plan" — the check still runs on the rest.
 *
 * Like compact, this step owns no clock: every date comes from ctx.now (the
 * run clock) or state, and the gap threshold is threaded from the episode
 * config — the SAME threshold compaction and the time-gap note use.
 */
import type { RunnableConfig } from '@langchain/core/runnables';

import type { LlmGateway } from '@domain/ai/ports';
import type { ChatMsg } from '@domain/ai/types';
import type { ITrainingService } from '@domain/training/ports';
import type { IUserFactsService, UserFact } from '@domain/user/ports';

import { type ConversationStateType, ctxOf } from '@infra/ai/graph/state';
import { COURSE_CHECK_V1 } from '@infra/ai/prompts/course-check/v1';

import { createLogger } from '@shared/logger';

import { COURSE_CHECK_DIRECTIVE_SCHEMA_NAME, CourseCheckDirectiveSchema } from './directive';
import { courseCheckEvent } from './events';
import { courseCheckFingerprint } from './fingerprint';

const log = createLogger('course-check');

export interface CourseCheckStepDeps {
  llmGateway: LlmGateway;
  userFacts: IUserFactsService;
  /** The active plan id is a fingerprint component ("before a durable write" rides on it). */
  trainingService: ITrainingService;
  config: {
    /** COURSE_CHECK_ENABLED, resolved once at the composition root. */
    enabled: boolean;
    /** EPISODE_GAP_HOURS × 3_600_000 — the long-gap event's threshold, threaded as data. */
    gapMs: number;
    /** A failed check is not re-attempted on the same fingerprint for this long (ms), threaded as data. */
    retryCooldownMs: number;
  };
}

/** COURSE_CHECK_RETRY_COOLDOWN_MINUTES default (15 min) — used when the composition root passes none. */
export const DEFAULT_RETRY_COOLDOWN_MS = 15 * 60_000;

export type CourseCheckStep = (
  state: ConversationStateType,
  config: RunnableConfig,
) => Promise<Partial<ConversationStateType>>;

/**
 * A failed attempt leaves the directive channel untouched (the previous one
 * keeps rendering) and remembers WHAT failed and WHEN, so the same fingerprint
 * is not re-attempted every turn while the provider is down.
 */
function failed(fingerprint: string, now: Date): Partial<ConversationStateType> {
  return { courseCheckFailure: { fingerprint, at: now.toISOString() } };
}

export function buildCourseCheckStep(deps: CourseCheckStepDeps): CourseCheckStep {
  const { llmGateway, userFacts, trainingService } = deps;
  // Destructured up front — the closure's `config` parameter is the LangGraph
  // RunnableConfig and shadows nothing (same discipline as the compact step).
  const { enabled, gapMs, retryCooldownMs } = deps.config;

  return async function courseCheckStep(state, config): Promise<Partial<ConversationStateType>> {
    if (!enabled) {
      // Off means off: a stored directive stops rendering — cleared once, then
      // the channel stays empty without further state writes.
      return state.courseDirective === null && state.courseCheckFailure === null
        ? {}
        : { courseDirective: null, courseCheckFailure: null };
    }

    const ctx = ctxOf(config as never);
    const { userId, runId, user, now } = ctx;
    const goal = user?.fitnessGoal ?? null;

    // Degraded reads degrade to what is known — try/catch (not .catch, which
    // misses a synchronously-missing method on a stub) so a broken port never
    // takes the run down with it.
    let facts: UserFact[] = [];
    try {
      facts = await userFacts.getForPrompt(userId, now);
    } catch (err) {
      log.error({ err, userId, runId }, 'Course-check facts load failed — checking without them');
    }
    let activePlanId: string | null = null;
    try {
      activePlanId = (await trainingService.getActivePlan(userId))?.id ?? null;
    } catch (err) {
      log.error({ err, userId, runId }, 'Course-check active-plan load failed — checking without it');
    }

    const fingerprint = courseCheckFingerprint({ facts, goal, phase: state.phase, activePlanId, now });
    const stored = state.courseDirective;
    const event = courseCheckEvent({
      fingerprint,
      stored,
      now,
      lastUserMessageAt: state.lastUserMessageAt !== null ? new Date(state.lastUserMessageAt) : null,
      gapMs,
      failure: state.courseCheckFailure,
      cooldownMs: retryCooldownMs,
    });
    if (event === null) {
      return {};
    }

    try {
      const sections = COURSE_CHECK_V1.render({ phase: state.phase, goal, facts, now, activePlanId });
      const messages: ChatMsg[] = sections.map(s => ({
        role: s.id === 'system' ? 'system' : 'user',
        content: s.text,
      }));
      const raw = await llmGateway.structured(CourseCheckDirectiveSchema, messages, {
        profile: 'course_check',
        schemaName: COURSE_CHECK_DIRECTIVE_SCHEMA_NAME,
        runId,
        userId,
      });
      // AC-FL-5: a malformed answer leaves the run untouched. The gateway
      // contract says the result is already schema-valid, but a stubbed or
      // degraded answer gets one last check here — never trust, never crash.
      const parsed = CourseCheckDirectiveSchema.safeParse(raw);
      if (!parsed.success) {
        log.warn(
          { userId, runId, phase: state.phase, event, err: parsed.error },
          'Course check returned a malformed directive — ignoring it',
        );
        return failed(fingerprint, now);
      }
      const directive = parsed.data;
      log.info({ userId, runId, phase: state.phase, event }, 'Course-check directive generated');
      return {
        courseDirective: { fingerprint, directive, generatedAt: now.toISOString() },
        courseCheckFailure: null,
      };
    } catch (err) {
      log.warn(
        { err, userId, runId, phase: state.phase, event },
        'Course check failed — the run continues without a new directive',
      );
      return failed(fingerprint, now);
    }
  };
}
