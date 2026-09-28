/**
 * `plan_creation.client_profile` / `session_planning.client_profile` blocks
 * (D-B) — moved verbatim from the identical `client_profile` section in
 * `prompts/phases/plan_creation/v1.ts` and `prompts/phases/session_planning/v1.ts`
 * (P4 context-budget plan, Task 2). The two phases render the same profile
 * text (BACKLOG "small P2 duplications") — one shared renderer, two block ids
 * (one per phase, per D-B) so each phase's block list stays self-describing.
 */
import type { User } from '@domain/user/services/user.service';

import type { ContextBlock } from './types';

export function buildClientProfileText(user: User | null): string {
  const profileSection = user
    ? [
        `Name: ${user.firstName ?? 'Unknown'}`,
        `Age: ${user.age ?? '?'}`,
        `Gender: ${user.gender ?? '?'}`,
        `Height: ${user.height ?? '?'} cm`,
        `Weight: ${user.weight ?? '?'} kg`,
        `Fitness Level: ${user.fitnessLevel ?? '?'}`,
        `Fitness Goal: ${user.fitnessGoal ?? '?'}`,
      ].join('\n')
    : 'Profile not loaded.';

  return `=== CLIENT PROFILE ===\n\n${profileSection}`;
}

export const PLAN_CREATION_CLIENT_PROFILE_V1: ContextBlock<object> = {
  id: 'plan_creation.client_profile',
  version: 'v1',
  render(_data, ctx) {
    return buildClientProfileText(ctx.user);
  },
};

export const SESSION_PLANNING_CLIENT_PROFILE_V1: ContextBlock<object> = {
  id: 'session_planning.client_profile',
  version: 'v1',
  render(_data, ctx) {
    return buildClientProfileText(ctx.user);
  },
};
