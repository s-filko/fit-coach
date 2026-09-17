import { estimateTokens } from '@infra/ai/context/token-estimator';
import { PHASE_PROMPTS, STANDALONE_PROMPTS } from '@infra/ai/prompts';
import { compose } from '@infra/ai/prompts/compose';
import type { PromptModule } from '@infra/ai/prompts/types';

import { ALL_FIXTURES } from '../fixtures/personas';
import { contextsForModule } from '../fixtures/prompt-contexts';
import type { CheckResult } from '../lib/reporter';

/** §4.1: rendered prompts may not contain these. */
export const FORBIDDEN_STRINGS = ['undefined', 'null', '[object Object]', 'NaN'];

/**
 * Literal phrases where a forbidden token is ordinary English prose rather than
 * a template hole. Exact strings only — no patterns — so the check stays dumb
 * and predictable: a NEW occurrence of a forbidden token still fails, including
 * a second, similar-looking phrase that is not listed here verbatim.
 *
 * The proper fix is the structural check, which validates the values actually
 * substituted into a prompt instead of scanning the whole rendered string. This
 * allowlist is the stopgap until then.
 */
export const FORBIDDEN_STRING_ALLOWLIST = [
  // src/infra/ai/prompts/phases/training/v1.ts RULES_TEXT — RULE 7 of the training prompt.
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
 * Per-module prompt budget in estimated tokens, keyed by registry module id.
 * Blocks fall through to the default (they are tiny). P4 replaces these with
 * PhaseSpec.budget.system; until then they are a ceiling generous enough to
 * pass today's prompts and tight enough to catch runaway growth.
 *
 * Measured headroom at the time these were set (min-max across the three
 * fixtures), as a baseline for any future recalibration:
 *   phase.registration      935-969    (budget  4000)
 *   phase.chat             1079-1119   (budget  4000)
 *   phase.plan_creation    1378-1385   (budget  8000)
 *   phase.session_planning 2199-2216   (budget 12000)
 *   phase.training         3391-3396   (budget  8000)
 *   summarizer               248       (budget  2000)
 *   block.*                  34-119    (default  8000)
 */
export const PROMPT_TOKEN_BUDGET: Record<string, number> = {
  'phase.registration': 4000,
  'phase.chat': 4000,
  'phase.plan_creation': 8000,
  'phase.session_planning': 12000,
  'phase.training': 8000,
  summarizer: 2000,
};

export const EVAL_PHASES = ['registration', 'chat', 'plan_creation', 'session_planning', 'training'];

export function checkRenderedPrompt(moduleId: string, fixtureName: string, rendered: string): CheckResult[] {
  const caseName = `${moduleId}/${fixtureName}`;
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
  const budget = PROMPT_TOKEN_BUDGET[moduleId] ?? 8000;
  results.push({
    case: caseName,
    check: 'within-token-budget',
    passed: tokens <= budget,
    detail: tokens <= budget ? undefined : `${tokens} estimated tokens exceeds budget ${budget}`,
  });

  return results;
}

/** §4.1 section presence: every id in the module's section contract must be rendered. */
export function checkSections(
  moduleId: string,
  fixtureName: string,
  renderedIds: string[],
  requiredIds: readonly string[],
): CheckResult[] {
  const missing = requiredIds.filter(id => !renderedIds.includes(id));
  return [
    {
      case: `${moduleId}/${fixtureName}`,
      check: 'required-sections-present',
      passed: missing.length === 0,
      detail: missing.length ? `missing sections: ${missing.join(', ')}` : undefined,
    },
  ];
}

interface Target {
  module: PromptModule<unknown>;
  requiredSections: readonly string[];
}

function targets(phaseArg: string): Target[] {
  const phases = Object.entries(PHASE_PROMPTS)
    .filter(([phase]) => phaseArg === 'all' || phase === phaseArg)
    .map(([, entry]) => ({ module: entry.current, requiredSections: entry.requiredSections }));
  const standalone =
    phaseArg === 'all'
      ? STANDALONE_PROMPTS.map(module => ({
          module,
          requiredSections: module.render(contextsForModule(module.id, ALL_FIXTURES[0].fixture)).map(s => s.id),
        }))
      : [];
  return [...phases, ...standalone];
}

export async function runL0(phaseArg: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const { module, requiredSections } of targets(phaseArg)) {
    for (const { name, fixture } of ALL_FIXTURES) {
      try {
        const sections = module.render(contextsForModule(module.id, fixture));
        results.push(...checkRenderedPrompt(module.id, name, compose(sections)));
        results.push(
          ...checkSections(
            module.id,
            name,
            sections.map(s => s.id),
            requiredSections,
          ),
        );
      } catch (err) {
        results.push({
          case: `${module.id}/${name}`,
          check: 'renders-without-throwing',
          passed: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return results;
}
