/**
 * Optional per-profile model overrides — ADR-0013 §7 (D-10), master plan P1 item 2.
 *   LLM_PROFILE_<NAME>_MODEL, LLM_PROFILE_<NAME>_TEMPERATURE, LLM_PROFILE_<NAME>_MAX_TOKENS
 * Absent variables mean "use LLM_MODEL / LLM_TEMPERATURE / the default max tokens".
 * This is the one deliberate exception to "no defaults in code" in config/index.ts:
 * the defaults are the existing required variables, not literals.
 */
import { parsePrefixedEnv } from './prefixed-env';

export interface LlmProfileOverride {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

const PROFILE_KEY = /^LLM_PROFILE_([A-Z0-9_]+)_(MODEL|TEMPERATURE|MAX_TOKENS)$/;

function setNumericField(
  key: string,
  field: 'TEMPERATURE' | 'MAX_TOKENS',
  raw: string,
  profile: LlmProfileOverride,
): void {
  const n = Number(raw);
  if (field === 'TEMPERATURE') {
    if (Number.isNaN(n) || n < 0 || n > 2) {
      throw new Error(`${key} must be a number in [0, 2]`);
    }
    profile.temperature = n;
  } else {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
    profile.maxTokens = n;
  }
}

export function parseLlmProfiles(env: NodeJS.ProcessEnv): Record<string, LlmProfileOverride> {
  return parsePrefixedEnv<LlmProfileOverride>({
    env,
    pattern: PROFILE_KEY,
    assign: (profile, { key, raw, field }) => {
      if (field === 'MODEL') {
        profile.model = raw.trim();
      } else {
        setNumericField(key, field as 'TEMPERATURE' | 'MAX_TOKENS', raw, profile);
      }
    },
  });
}
