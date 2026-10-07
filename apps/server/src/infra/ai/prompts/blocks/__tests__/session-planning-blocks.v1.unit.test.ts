/**
 * `session_planning.active_plan` / `recent_history` / `recovery_timeline` ==
 * v1's matching sections, character for character (P4 context-budget plan,
 * Task 2).
 */
import { sectionText } from '@infra/ai/prompts/compose';
import { SESSION_PLANNING_V1 } from '@infra/ai/prompts/phases/session_planning/v1';
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { ALL_FIXTURES } from '../../../../../../evals/fixtures/personas';
import { contextsForModule } from '../../../../../../evals/fixtures/prompt-contexts';
import { buildHistorySection, SESSION_PLANNING_RECENT_HISTORY_V1 } from '../session-planning-recent-history.v1';
import { SESSION_PLANNING_ACTIVE_PLAN_V1 } from '../session-planning-active-plan.v1';
import { SESSION_PLANNING_RECOVERY_TIMELINE_V1 } from '../session-planning-recovery-timeline.v1';
import type { ContextBlockCtx } from '../types';

type V1Ctx = Parameters<typeof SESSION_PLANNING_V1.render>[0];

describe('SESSION_PLANNING_ACTIVE_PLAN_V1 == v1 section "active_plan"', () => {
  it.each(ALL_FIXTURES)('$name', ({ fixture }) => {
    const v1Ctx = contextsForModule('phase.session_planning', fixture) as V1Ctx;
    const expected = sectionText(SESSION_PLANNING_V1.render(v1Ctx), 'active_plan');

    const actual = SESSION_PLANNING_ACTIVE_PLAN_V1.render({ context: v1Ctx.context }, {} as ContextBlockCtx, 0);

    expect(actual).toBe(expected);
  });
});

describe('SESSION_PLANNING_RECENT_HISTORY_V1 == v1 section "recent_history"', () => {
  it.each(ALL_FIXTURES)('$name', ({ fixture }) => {
    const v1Ctx = contextsForModule('phase.session_planning', fixture) as V1Ctx;
    const expected = sectionText(SESSION_PLANNING_V1.render(v1Ctx), 'recent_history');

    const blockCtx: ContextBlockCtx = { now: v1Ctx.now, timezone: v1Ctx.timezone, user: v1Ctx.user };
    const actual = SESSION_PLANNING_RECENT_HISTORY_V1.render(
      { recentSessions: v1Ctx.context.recentSessions },
      blockCtx,
      5,
    );

    expect(actual).toBe(expected);
  });

  it('depth 5 is the block default (full depth)', () => {
    expect(SESSION_PLANNING_RECENT_HISTORY_V1.depths?.[0]).toBe(5);
  });
});

describe('buildHistorySection — bodyweight wording (AC-PTF-6)', () => {
  const sessionWith = (sets: WorkoutSessionWithDetails['exercises'][number]['sets']): WorkoutSessionWithDetails =>
    ({
      startedAt: new Date('2026-09-27T10:00:00.000Z'),
      status: 'completed',
      exercises: [
        {
          exercise: { name: 'Pull-up' },
          sets,
        },
      ],
    }) as never;

  it('names a bodyweight set "bodyweight" in full — never "BW" or the bare type name', () => {
    const sets = [
      { setNumber: 1, setData: { type: 'strength', reps: 8 } },
      { setNumber: 2, setData: { type: 'functional_reps', reps: 8 } },
    ] as never;

    const out = buildHistorySection([sessionWith(sets)], new Date('2026-10-07T10:00:00.000Z'));

    expect(out).toContain('8×bodyweight');
    expect(out).not.toContain('BW');
    expect(out).not.toContain('functional_reps');
  });
});

describe('SESSION_PLANNING_RECOVERY_TIMELINE_V1 == v1 section "recovery_timeline"', () => {
  it.each(ALL_FIXTURES)('$name', ({ fixture }) => {
    const v1Ctx = contextsForModule('phase.session_planning', fixture) as V1Ctx;
    const expected = sectionText(SESSION_PLANNING_V1.render(v1Ctx), 'recovery_timeline');

    const blockCtx: ContextBlockCtx = { now: v1Ctx.now, timezone: v1Ctx.timezone, user: v1Ctx.user };
    const actual = SESSION_PLANNING_RECOVERY_TIMELINE_V1.render(
      { recentSessions: v1Ctx.context.recentSessions },
      blockCtx,
      0,
    );

    expect(actual).toBe(expected);
  });
});
