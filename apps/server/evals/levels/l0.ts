import type { SessionPlanningContextData } from '@domain/training/services/session-planning-context.builder';
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import type { User } from '@domain/user/services/user.service';

import { ALL_FIXTURES } from '../fixtures/personas';
import type { CheckResult } from '../lib/reporter';
import { estimateTokens } from '../lib/token-estimator';
import type { EvalFixture } from '../schema/case.schema';

/** §4.1: rendered prompts may not contain these. */
export const FORBIDDEN_STRINGS = ['undefined', 'null', '[object Object]', 'NaN'];

/**
 * A forbidden token is a defect only when it lands where a *value* should be —
 * a template hole. The same words appear as ordinary English in real prompt
 * copy (the training prompt says "may execute in undefined sequence"), and
 * flagging those would force prompt edits to satisfy the harness, which §4.1
 * explicitly does not want.
 *
 * Value position = immediately after ':' / '=' / '(' / '[' / '<b>'-style markup,
 * or immediately followed by a unit or list separator. '[object Object]' is
 * never prose, so it is always a hit.
 */
const VALUE_POSITION = String.raw`(?:^|[:=(\[,>|]\s*|\s-\s)`;
const VALUE_TRAILER = String.raw`(?:\s*(?:$|[,;)\]<|]|\s(?:kg|cm|min|years?|sets?|reps?)\b))`;

function findForbiddenHits(rendered: string): string[] {
  return FORBIDDEN_STRINGS.filter(token => {
    if (token === '[object Object]') {
      return rendered.includes(token);
    }
    // A hit needs either a value-position lead-in or a value-shaped trailer.
    // Requiring both would miss "age is undefined years"; requiring neither
    // would flag "may execute in undefined sequence".
    const leadIn = new RegExp(`${VALUE_POSITION}${token}\\b`, 'm');
    const trailer = new RegExp(`\\b${token}\\b${VALUE_TRAILER}`, 'm');
    return leadIn.test(rendered) || trailer.test(rendered);
  });
}

/**
 * Per-phase system-prompt budget in estimated tokens. P2 replaces these with
 * PhaseSpec.budget.system; until then they are a ceiling generous enough to
 * pass today's prompts and tight enough to catch runaway growth.
 */
export const PHASE_TOKEN_BUDGET: Record<string, number> = {
  registration: 4000,
  chat: 4000,
  plan_creation: 8000,
  session_planning: 12000,
  training: 8000,
};

export const EVAL_PHASES = ['registration', 'chat', 'plan_creation', 'session_planning', 'training'];

export function checkRenderedPrompt(phase: string, fixtureName: string, rendered: string): CheckResult[] {
  const caseName = `${phase}/${fixtureName}`;
  const results: CheckResult[] = [];

  results.push({
    case: caseName,
    check: 'renders-non-empty',
    passed: rendered.trim().length > 0,
    detail: rendered.trim().length > 0 ? undefined : 'rendered prompt is empty',
  });

  const hits = findForbiddenHits(rendered);
  results.push({
    case: caseName,
    check: 'no-forbidden-strings',
    passed: hits.length === 0,
    detail: hits.length > 0 ? `contains ${hits.join(', ')}` : undefined,
  });

  const tokens = estimateTokens(rendered);
  const budget = PHASE_TOKEN_BUDGET[phase] ?? 8000;
  results.push({
    case: caseName,
    check: 'within-token-budget',
    passed: tokens <= budget,
    detail: tokens <= budget ? undefined : `${tokens} estimated tokens exceeds budget ${budget}`,
  });

  return results;
}

/**
 * Maps a fixture persona onto the production `User` domain type. The fixture
 * schema deliberately mirrors it, so this is a narrowing, not a translation.
 */
function toUser(fixture: EvalFixture): User {
  const { registrationCompleted, ...profile } = fixture.user;
  return {
    id: 'eval-user-1',
    profileStatus: registrationCompleted === true ? 'complete' : 'collecting',
    ...profile,
  };
}

/**
 * A minimal but structurally complete `WorkoutSessionWithDetails`, needed by
 * buildTrainingSystemPrompt. Dates are fixed so the rendered prompt is stable
 * except for relative-time phrasing.
 */
function buildFixtureSession(fixture: EvalFixture): WorkoutSessionWithDetails {
  const now = new Date();
  const active = fixture.activeSession as { id?: string; sessionKey?: string } | undefined;
  return {
    id: active?.id ?? 'eval-session-1',
    userId: 'eval-user-1',
    planId: 'eval-plan-1',
    sessionKey: active?.sessionKey ?? 'Upper A',
    status: 'in_progress',
    startedAt: now,
    completedAt: null,
    durationMinutes: null,
    userContextJson: null,
    sessionPlanJson: null,
    lastActivityAt: now,
    autoCloseReason: null,
    createdAt: now,
    updatedAt: now,
    exercises: [],
  };
}

function buildSessionPlanningContext(fixture: EvalFixture): SessionPlanningContextData {
  return {
    activePlan: null,
    recentSessions: fixture.activeSession ? [buildFixtureSession(fixture)] : [],
    daysSinceLastWorkout: fixture.activeSession ? 0 : null,
  };
}

async function renderPrompt(phase: string, fixture: EvalFixture): Promise<string> {
  const user = toUser(fixture);
  switch (phase) {
    case 'registration': {
      const { buildRegistrationSystemPrompt } = await import('@infra/ai/graph/nodes/registration.node');
      return buildRegistrationSystemPrompt(user);
    }
    case 'chat': {
      const { buildChatSystemPrompt } = await import('@infra/ai/graph/nodes/chat.node');
      return buildChatSystemPrompt(user, fixture.hasActivePlan ?? false, [], null);
    }
    case 'plan_creation': {
      const { buildPlanCreationSystemPrompt } = await import('@infra/ai/graph/nodes/plan-creation.node');
      return buildPlanCreationSystemPrompt(user);
    }
    case 'session_planning': {
      const { buildSessionPlanningSystemPrompt } = await import('@infra/ai/graph/nodes/session-planning.node');
      return buildSessionPlanningSystemPrompt(user, buildSessionPlanningContext(fixture));
    }
    case 'training': {
      const { buildTrainingSystemPrompt } = await import('@infra/ai/graph/nodes/training.node');
      return buildTrainingSystemPrompt(user, buildFixtureSession(fixture), null);
    }
    default:
      throw new Error(`No L0 renderer wired for phase ${phase}`);
  }
}

export async function runL0(phaseArg: string): Promise<CheckResult[]> {
  const phases = phaseArg === 'all' ? EVAL_PHASES : [phaseArg];
  const results: CheckResult[] = [];

  for (const phase of phases) {
    for (const { name, fixture } of ALL_FIXTURES) {
      try {
        results.push(...checkRenderedPrompt(phase, name, await renderPrompt(phase, fixture)));
      } catch (err) {
        results.push({
          case: `${phase}/${name}`,
          check: 'renders-without-throwing',
          passed: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return results;
}
