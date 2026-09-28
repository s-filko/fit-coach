/**
 * `plan_creation.client_profile` / `session_planning.client_profile` ==
 * v1's `client_profile` section in each phase, character for character
 * (P4 context-budget plan, Task 2).
 */
import { sectionText } from '@infra/ai/prompts/compose';
import { PLAN_CREATION_V1 } from '@infra/ai/prompts/phases/plan_creation/v1';
import { SESSION_PLANNING_V1 } from '@infra/ai/prompts/phases/session_planning/v1';

import { ALL_FIXTURES } from '../../../../../../evals/fixtures/personas';
import { contextsForModule } from '../../../../../../evals/fixtures/prompt-contexts';
import { PLAN_CREATION_CLIENT_PROFILE_V1, SESSION_PLANNING_CLIENT_PROFILE_V1 } from '../client-profile.v1';
import type { ContextBlockCtx } from '../types';

describe('PLAN_CREATION_CLIENT_PROFILE_V1 == phase.plan_creation v1 section "client_profile"', () => {
  it.each(ALL_FIXTURES)('$name', ({ fixture }) => {
    const v1Ctx = contextsForModule('phase.plan_creation', fixture) as Parameters<typeof PLAN_CREATION_V1.render>[0];
    const expected = sectionText(PLAN_CREATION_V1.render(v1Ctx), 'client_profile');

    const blockCtx: ContextBlockCtx = { now: v1Ctx.now, timezone: v1Ctx.timezone, user: v1Ctx.user };
    const actual = PLAN_CREATION_CLIENT_PROFILE_V1.render({}, blockCtx, 0);

    expect(actual).toBe(expected);
  });
});

describe('SESSION_PLANNING_CLIENT_PROFILE_V1 == phase.session_planning v1 section "client_profile"', () => {
  it.each(ALL_FIXTURES)('$name', ({ fixture }) => {
    const v1Ctx = contextsForModule('phase.session_planning', fixture) as Parameters<
      typeof SESSION_PLANNING_V1.render
    >[0];
    const expected = sectionText(SESSION_PLANNING_V1.render(v1Ctx), 'client_profile');

    const blockCtx: ContextBlockCtx = { now: v1Ctx.now, timezone: v1Ctx.timezone, user: v1Ctx.user };
    const actual = SESSION_PLANNING_CLIENT_PROFILE_V1.render({}, blockCtx, 0);

    expect(actual).toBe(expected);
  });

  it('renders identical text for plan_creation and session_planning (shared renderer, BACKLOG dedup)', () => {
    const blockCtx: ContextBlockCtx = {
      now: new Date('2026-09-13T10:00:00.000Z'),
      timezone: 'Europe/Berlin',
      user: null,
    };
    expect(SESSION_PLANNING_CLIENT_PROFILE_V1.render({}, blockCtx, 0)).toBe(
      PLAN_CREATION_CLIENT_PROFILE_V1.render({}, blockCtx, 0),
    );
  });
});
