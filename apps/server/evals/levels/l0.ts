import { ALL_FIXTURES } from '../fixtures/personas';
import { FIXED_NOW, buildFixtureSession, buildSessionPlanningContext, toUser } from '../fixtures/prompt-contexts';
import type { CheckResult } from '../lib/reporter';
import { estimateTokens } from '../lib/token-estimator';
import type { EvalFixture } from '../schema/case.schema';

/** §4.1: rendered prompts may not contain these. */
export const FORBIDDEN_STRINGS = ['undefined', 'null', '[object Object]', 'NaN'];

/**
 * Literal phrases where a forbidden token is ordinary English prose rather than
 * a template hole. Exact strings only — no patterns — so the check stays dumb
 * and predictable: a NEW occurrence of a forbidden token still fails, including
 * a second, similar-looking phrase that is not listed here verbatim.
 *
 * The proper fix is P2's structural check, which validates the values actually
 * substituted into a prompt instead of scanning the whole rendered string. This
 * allowlist is the stopgap until then.
 */
export const FORBIDDEN_STRING_ALLOWLIST = [
  // src/infra/ai/graph/nodes/training.node.ts:94 — RULE 7 of the training prompt.
  // "undefined" here is English ("in undefined sequence"), not an unrendered value.
  'Sets without order may execute in undefined sequence',
];

function findForbiddenHits(rendered: string): string[] {
  let scannable = rendered;
  for (const phrase of FORBIDDEN_STRING_ALLOWLIST) {
    scannable = scannable.split(phrase).join('');
  }
  return FORBIDDEN_STRINGS.filter(token => scannable.includes(token));
}

/**
 * Per-phase system-prompt budget in estimated tokens. P2 replaces these with
 * PhaseSpec.budget.system; until then they are a ceiling generous enough to
 * pass today's prompts and tight enough to catch runaway growth.
 *
 * Measured headroom at the time these were set (min-max across the three
 * fixtures), as a baseline for any future recalibration:
 *   registration      935-969    (budget  4000)
 *   chat             1006-1046   (budget  4000)
 *   plan_creation    1378-1385   (budget  8000)
 *   session_planning 2199-2215   (budget 12000)
 *   training         3391-3396   (budget  8000)
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
 * Maps a fixture persona onto the production `User` domain type, builds fixture
 * sessions and context data — all shared with the snapshot suite via
 * evals/fixtures/prompt-contexts.ts.
 */

async function renderPrompt(phase: string, fixture: EvalFixture): Promise<string> {
  const user = toUser(fixture);
  switch (phase) {
    case 'registration': {
      const { compose } = await import('@infra/ai/prompts/compose');
      const { REGISTRATION_PROMPT } = await import('@infra/ai/prompts/phases/registration');
      return compose(
        REGISTRATION_PROMPT.current.render({
          now: FIXED_NOW,
          timezone: user.timezone ?? null,
          client: 'telegram',
          user,
          lastMessageTime: null,
        }),
      );
    }
    case 'chat': {
      const { compose } = await import('@infra/ai/prompts/compose');
      const { CHAT_PROMPT } = await import('@infra/ai/prompts/phases/chat');
      return compose(
        CHAT_PROMPT.current.render({
          now: FIXED_NOW,
          timezone: user.timezone ?? null,
          client: 'telegram',
          user,
          lastMessageTime: null,
          hasActivePlan: fixture.hasActivePlan ?? false,
          recentSessions: [],
        }),
      );
    }
    case 'plan_creation': {
      const { compose } = await import('@infra/ai/prompts/compose');
      const { PLAN_CREATION_PROMPT } = await import('@infra/ai/prompts/phases/plan_creation');
      return compose(
        PLAN_CREATION_PROMPT.current.render({
          now: FIXED_NOW,
          timezone: user.timezone ?? null,
          client: 'telegram',
          user,
          lastMessageTime: null,
        }),
      );
    }
    case 'session_planning': {
      const { compose } = await import('@infra/ai/prompts/compose');
      const { SESSION_PLANNING_PROMPT } = await import('@infra/ai/prompts/phases/session_planning');
      return compose(
        SESSION_PLANNING_PROMPT.current.render({
          now: FIXED_NOW,
          timezone: user.timezone ?? null,
          client: 'telegram',
          user,
          lastMessageTime: null,
          context: buildSessionPlanningContext(fixture, FIXED_NOW),
        }),
      );
    }
    case 'training': {
      const { buildTrainingSystemPrompt } = await import('@infra/ai/graph/nodes/training.node');
      return buildTrainingSystemPrompt(user, buildFixtureSession(fixture, FIXED_NOW), null);
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
