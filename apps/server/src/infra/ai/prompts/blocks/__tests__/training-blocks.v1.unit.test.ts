/**
 * `training.client` / `workout_overview` / `stale_session` / `previous_session`
 * == v1's matching sections, character for character (P4 context-budget
 * plan, Task 2). Stale/previous-session presence is exercised directly
 * (the L0 fixtures don't trigger either gate) — the block's null-vs-present
 * decision must match v1's `isStale` / `if (previousSession)` gates exactly.
 */
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { sectionText } from '@infra/ai/prompts/compose';
import { TRAINING_V1 } from '@infra/ai/prompts/phases/training/v1';

import { ALL_FIXTURES } from '../../../../../../evals/fixtures/personas';
import { buildFixtureSession, contextsForModule, FIXED_NOW } from '../../../../../../evals/fixtures/prompt-contexts';
import {
  TRAINING_CLIENT_V1,
  TRAINING_PREVIOUS_SESSION_V1,
  TRAINING_STALE_SESSION_V1,
  TRAINING_WORKOUT_OVERVIEW_V1,
} from '../training-workout-overview.v1';
import type { ContextBlockCtx } from '../types';

type V1Ctx = Parameters<typeof TRAINING_V1.render>[0];

describe('TRAINING_CLIENT_V1 == v1 section "client"', () => {
  it.each(ALL_FIXTURES)('$name', ({ fixture }) => {
    const v1Ctx = contextsForModule('phase.training', fixture) as V1Ctx;
    const expected = sectionText(TRAINING_V1.render(v1Ctx), 'client');

    const blockCtx: ContextBlockCtx = { now: v1Ctx.now, timezone: v1Ctx.timezone, user: v1Ctx.user };
    const actual = TRAINING_CLIENT_V1.render({ previousSession: null }, blockCtx, 0);

    expect(actual).toBe(expected);
  });
});

describe('TRAINING_WORKOUT_OVERVIEW_V1 == v1 section "workout_overview"', () => {
  it.each(ALL_FIXTURES)('$name', ({ fixture }) => {
    const v1Ctx = contextsForModule('phase.training', fixture) as V1Ctx;
    const expected = sectionText(TRAINING_V1.render(v1Ctx), 'workout_overview');

    const blockCtx: ContextBlockCtx = { now: v1Ctx.now, timezone: v1Ctx.timezone, user: v1Ctx.user };
    const actual = TRAINING_WORKOUT_OVERVIEW_V1.render({ session: v1Ctx.session }, blockCtx, 0);

    expect(actual).toBe(expected);
  });
});

describe('TRAINING_STALE_SESSION_V1 gate matches v1 isStale', () => {
  it('absent (null) for a fresh session — matches L0 fixture (not required by v1)', () => {
    const v1Ctx = contextsForModule('phase.training', ALL_FIXTURES[2].fixture) as V1Ctx;
    const ids = TRAINING_V1.render(v1Ctx).map(s => s.id);
    expect(ids).not.toContain('stale_session');

    const blockCtx: ContextBlockCtx = { now: v1Ctx.now, timezone: v1Ctx.timezone, user: v1Ctx.user };
    expect(TRAINING_STALE_SESSION_V1.render({ session: v1Ctx.session }, blockCtx, 0)).toBeNull();
  });

  it('present and byte-identical to v1 when the session is stale (> 2h inactive)', () => {
    const staleSession: WorkoutSessionWithDetails = {
      ...buildFixtureSession(ALL_FIXTURES[2].fixture, FIXED_NOW),
      lastActivityAt: new Date(FIXED_NOW.getTime() - 3 * 60 * 60 * 1000),
    };
    const v1Ctx: V1Ctx = {
      ...(contextsForModule('phase.training', ALL_FIXTURES[2].fixture) as V1Ctx),
      session: staleSession,
    };
    const expected = sectionText(TRAINING_V1.render(v1Ctx), 'stale_session');

    const blockCtx: ContextBlockCtx = { now: v1Ctx.now, timezone: v1Ctx.timezone, user: v1Ctx.user };
    const actual = TRAINING_STALE_SESSION_V1.render({ session: staleSession }, blockCtx, 0);

    expect(actual).toBe(expected);
  });
});

describe('TRAINING_PREVIOUS_SESSION_V1 gate matches v1 if (previousSession)', () => {
  it('absent (null) when there is no previous session — matches L0 fixtures', () => {
    const v1Ctx = contextsForModule('phase.training', ALL_FIXTURES[2].fixture) as V1Ctx;
    const ids = TRAINING_V1.render(v1Ctx).map(s => s.id);
    expect(ids).not.toContain('previous_session');

    const blockCtx: ContextBlockCtx = { now: v1Ctx.now, timezone: v1Ctx.timezone, user: v1Ctx.user };
    expect(TRAINING_PREVIOUS_SESSION_V1.render({ previousSession: null }, blockCtx, 0)).toBeNull();
  });

  it('present and byte-identical to v1 when a previous session exists', () => {
    const previousSession = buildFixtureSession(ALL_FIXTURES[2].fixture, FIXED_NOW);
    const v1Ctx: V1Ctx = {
      ...(contextsForModule('phase.training', ALL_FIXTURES[2].fixture) as V1Ctx),
      previousSession,
    };
    const expected = sectionText(TRAINING_V1.render(v1Ctx), 'previous_session');

    const blockCtx: ContextBlockCtx = { now: v1Ctx.now, timezone: v1Ctx.timezone, user: v1Ctx.user };
    const actual = TRAINING_PREVIOUS_SESSION_V1.render({ previousSession }, blockCtx, 0);

    expect(actual).toBe(expected);
  });
});
