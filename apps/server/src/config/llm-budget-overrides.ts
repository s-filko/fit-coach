/**
 * Optional per-phase token budget overrides — ADR-0013 §3.4, P4 context-budget
 * plan (D-A/D-L exception): `LLM_BUDGET_<PHASE>_<PART>` for PART in
 * `SYSTEM | LONG_TERM | DOMAIN | HISTORY | OUTPUT_RESERVE` (TokenBudget's
 * fields). Absent variables mean "use the phase's `PhaseSpec.budget` default
 * (Task 1's measured table)". Same "tunables, not secrets" exception as
 * `LLM_PROFILE_*` and `EPISODE_*` in `config/index.ts` — the mechanism is the
 * invariant (INV-LLM-004), not the values.
 */
import { parsePrefixedEnv } from './prefixed-env';

export interface TokenBudgetOverride {
  system?: number;
  longTerm?: number;
  domain?: number;
  history?: number;
  outputReserve?: number;
}

const BUDGET_KEY = /^LLM_BUDGET_([A-Z0-9]+(?:_[A-Z0-9]+)*)_(SYSTEM|LONG_TERM|DOMAIN|HISTORY|OUTPUT_RESERVE)$/;

const FIELD_BY_PART: Record<string, keyof TokenBudgetOverride> = {
  SYSTEM: 'system',
  LONG_TERM: 'longTerm',
  DOMAIN: 'domain',
  HISTORY: 'history',
  OUTPUT_RESERVE: 'outputReserve',
};

/**
 * The phase name is everything before the trailing PART token — since phase
 * names themselves may contain underscores (`session_planning`,
 * `plan_creation`), the regex captures the PART separately and the phase is
 * whatever remains, lower-cased.
 */
export function parseLlmBudgetOverrides(env: NodeJS.ProcessEnv): Record<string, TokenBudgetOverride> {
  return parsePrefixedEnv<TokenBudgetOverride>({
    env,
    pattern: BUDGET_KEY,
    assign: (override, { key, raw, field }) => {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`${key} must be a positive integer`);
      }
      override[FIELD_BY_PART[field]] = n;
    },
  });
}
