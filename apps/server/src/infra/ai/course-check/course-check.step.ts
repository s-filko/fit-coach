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
 * Expiry is PERFORMED here, in this one place (the step owns the run clock and
 * already reads the facts): every active short fact past its TTL is either
 * `forget` — archived silently (`archived_reason: 'expired'`) — or `ask_once`
 * — handed to the check as an EXPIRED fact owed one question and archived only
 * AFTER the directive that carries it was produced, so it is asked once and a
 * failed call loses nothing (it stays due and is retried, cooldown permitting).
 * With the layer off nobody can ask, so both kinds are archived without a
 * question. `getForPrompt` / `getConstraints` never change: expired rows stay
 * hidden from the prompt and the guard whether or not they are archived yet.
 * Archiving follows the compaction's per-operation discipline: a failure logs
 * an error and never fails or blocks the run.
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
import { expiryAction } from '@domain/user/services/fact-lifecycle';

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
    /**
     * COURSE_CHECK_EXPIRY_ASK_WINDOW_DAYS in ms, threaded as data: an ask_once
     * fact expired LONGER ago than this is archived silently, never asked about.
     */
    expiryAskWindowMs: number;
  };
}

/** COURSE_CHECK_EXPIRY_ASK_WINDOW_DAYS default (7 days) — used when the composition root passes none. */
export const DEFAULT_EXPIRY_ASK_WINDOW_MS = 7 * 86_400_000;

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
  const { enabled, gapMs, retryCooldownMs, expiryAskWindowMs } = deps.config;

  /** Archives expired facts one by one; each failure is logged and skipped (never fails the run). */
  async function archiveExpired(list: UserFact[], userId: string, runId: string, now: Date): Promise<void> {
    for (const fact of list) {
      try {
        await userFacts.archiveExpired(userId, fact.id, now);
      } catch (err) {
        log.error({ err, userId, runId, factId: fact.id }, 'Archiving an expired fact failed — the run continues');
      }
    }
  }

  async function checkStep(
    state: ConversationStateType,
    config: RunnableConfig,
  ): Promise<Partial<ConversationStateType>> {
    const ctx = ctxOf(config as never);
    const { userId, runId, user, now } = ctx;
    const goal = user?.fitnessGoal ?? null;

    // Expiry, performed: the one "due" read, then the silent archive of every
    // `forget` fact. Independent of the layer's switch and of the event below.
    let expired: UserFact[] = [];
    try {
      expired = await userFacts.getExpiredActive(userId, now);
    } catch (err) {
      log.error({ err, userId, runId }, 'Expired-facts load failed — expiry is not performed this run');
    }
    // Past the staleness bound an ask_once fact is 'forget' too: archived silently, never a question.
    await archiveExpired(
      expired.filter(f => expiryAction(f, now, expiryAskWindowMs) === 'forget'),
      userId,
      runId,
      now,
    );
    const ask = expired.filter(f => expiryAction(f, now, expiryAskWindowMs) === 'ask');

    if (!enabled) {
      // Nobody can ask with the layer off: the ask_once facts are archived too.
      await archiveExpired(ask, userId, runId, now);
      // Off means off: a stored directive stops rendering — cleared once, then
      // the channel stays empty without further state writes.
      return state.courseDirective === null && state.courseCheckFailure === null
        ? {}
        : { courseDirective: null, courseCheckFailure: null };
    }

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

    // The hash the EVENT sees includes the ask-due facts (their becoming due is
    // an input change); the hash that is STORED is the settled one — those facts
    // emptied, as they are once the question was put and they are archived — so
    // the next run recomputes the same value and does not refire.
    const inputs = { facts, goal, phase: state.phase, activePlanId, now };
    const fingerprint = courseCheckFingerprint({ ...inputs, expiredAsk: ask });
    const settledFingerprint = ask.length === 0 ? fingerprint : courseCheckFingerprint(inputs);
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
      const sections = COURSE_CHECK_V1.render({ phase: state.phase, goal, facts, now, activePlanId, expiredAsk: ask });
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
      // ONE-SHOT: the expiry questions belong to this run — the facts they are about
      // are archived below — so they ride a transient channel (rendered by the agent,
      // cleared by commit) and the directive is persisted WITHOUT them. Everything
      // else in the directive persists exactly as before. Questions about facts that
      // were not owed one (none due this run) are dropped, not stored.
      const { expiryQuestions, ...directive } = parsed.data;
      const asked = ask.length > 0 ? (expiryQuestions ?? []) : [];
      log.info({ userId, runId, phase: state.phase, event }, 'Course-check directive generated');
      // The question is in the directive — only now are the ask_once facts archived
      // (asked once; a failed call above leaves them due, so nothing is lost).
      await archiveExpired(ask, userId, runId, now);
      return {
        courseDirective: { fingerprint: settledFingerprint, directive, generatedAt: now.toISOString() },
        courseCheckFailure: null,
        ...(asked.length > 0 ? { courseExpiryQuestions: asked } : {}),
      };
    } catch (err) {
      log.warn(
        { err, userId, runId, phase: state.phase, event },
        'Course check failed — the run continues without a new directive',
      );
      return failed(fingerprint, now);
    }
  }

  // A previous run's one-shot questions never outlive it: whatever this run does
  // (fires, backs off, stays quiet, is switched off), a leftover is cleared.
  return async function courseCheckStep(state, config): Promise<Partial<ConversationStateType>> {
    const updates = await checkStep(state, config);
    return state.courseExpiryQuestions.length > 0 && updates.courseExpiryQuestions === undefined
      ? { ...updates, courseExpiryQuestions: [] }
      : updates;
  };
}
