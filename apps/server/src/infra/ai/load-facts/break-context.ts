/**
 * load-plan plan Task 4 (D9, design §5): the training-break context of one run — the tier of the gap since the last
 * real workout and whether the reason question is still to be asked. One service for the time-gap note; the tier
 * comes from the same code `LOAD PLAN` reads (`gapTierOf`).
 *
 * "Asked once" survives restarts without a schema change: the moment the question is first put to the model the
 * code stores a `break` fact with reason `unknown` for this gap. The fact is the marker (never asked again while it
 * covers the gap, even once expired or archived), the honest answer for a user who does not reply, and the
 * placeholder the summariser updates when they do. Never throws — a failure here must not fail a run.
 */
import { breakReasonOf, calendarDate, formatBreakFact, GAP_TIER_PARAMS, gapTierOf } from '@domain/training/load-plan';
import type { IWorkoutSessionRepository } from '@domain/training/ports';
import type { IUserFactsService } from '@domain/user/ports';

import type { TrainingBreakNote } from '@infra/ai/prompts/blocks';

import { calendarDaysAgo } from '@shared/date-utils';
import { createLogger } from '@shared/logger';

const log = createLogger('break-context');

/** The marker's lifetime: the short-class cap — about the length of the return ladder. */
const MARKER_TTL_DAYS = 14;

export interface BreakContextDeps {
  workoutSessionRepo: Pick<IWorkoutSessionRepository, 'findRecentByUserIdWithDetails'>;
  userFacts: Pick<IUserFactsService, 'listFacts' | 'getExpiredActive' | 'rememberFact'>;
}

export interface IBreakContext {
  /** Null when the last workout is within the normal spacing (or there is none). */
  resolve(userId: string, now: Date, timezone: string | null): Promise<TrainingBreakNote | null>;
}

export class BreakContext implements IBreakContext {
  constructor(private deps: BreakContextDeps) {}

  async resolve(userId: string, now: Date, timezone: string | null): Promise<TrainingBreakNote | null> {
    try {
      return await this.resolveUnsafe(userId, now, timezone);
    } catch (err) {
      log.error({ err, userId }, 'break context failed — no training-break note this run');
      return null;
    }
  }

  private async resolveUnsafe(userId: string, now: Date, timezone: string | null): Promise<TrainingBreakNote | null> {
    const [lastWorkout] = await this.deps.workoutSessionRepo.findRecentByUserIdWithDetails(userId, 1, {
      realWorkoutsOnly: true,
    });
    if (!lastWorkout) {
      return null;
    }
    const last = lastWorkout.completedAt ?? lastWorkout.createdAt;
    const days = calendarDaysAgo(last, now, timezone);
    if (days <= GAP_TIER_PARAMS.restWithQuestionAboveDays.value) {
      return null;
    }
    const tier = gapTierOf(days);
    const window = { from: calendarDate(last, timezone), to: calendarDate(now, timezone) };

    const [listing, expired] = await Promise.all([
      this.deps.userFacts.listFacts(userId, true, now),
      this.deps.userFacts.getExpiredActive(userId, now),
    ]);
    const known = [...listing.active, ...listing.archived, ...expired].filter(f => f.category === 'break');
    if (known.some(f => breakReasonOf([f], window) !== null)) {
      return { tier, days, ask: false };
    }
    try {
      await this.deps.userFacts.rememberFact(
        userId,
        {
          category: 'break',
          fact: formatBreakFact({ reason: 'unknown', from: window.from, to: window.to, words: '' }),
          durability: 'short',
          ttlDays: MARKER_TTL_DAYS,
          onExpiry: 'forget',
          context: 'the coach was told to ask the reason once',
        },
        now,
      );
    } catch (err) {
      // No marker, no question: better silent than asking again on every message.
      log.error({ err, userId }, 'break marker not stored — the reason question is skipped');
      return { tier, days, ask: false };
    }
    return { tier, days, ask: true };
  }
}
