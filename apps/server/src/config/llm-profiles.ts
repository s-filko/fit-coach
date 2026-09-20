/**
 * Optional per-profile model overrides — ADR-0013 §7 (D-10), master plan P1 item 2.
 *   LLM_PROFILE_<NAME>_MODEL, LLM_PROFILE_<NAME>_TEMPERATURE, LLM_PROFILE_<NAME>_MAX_TOKENS,
 *   LLM_PROFILE_<NAME>_REASONING_EFFORT
 * Absent variables mean "use LLM_MODEL / LLM_TEMPERATURE / the config defaults".
 * This is the one deliberate exception to "no defaults in code" in config/index.ts:
 * the defaults are the existing required variables, not literals.
 */
import { parsePrefixedEnv } from './prefixed-env';

/** Reasoning-depth values (BUG-019 / AC-RL-1); 'off' omits the request field. */
export const REASONING_EFFORTS = ['low', 'high', 'max', 'off'] as const;
export type LlmReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface LlmProfileOverride {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: LlmReasoningEffort;
}

const PROFILE_KEY = /^LLM_PROFILE_([A-Z0-9_]+)_(MODEL|TEMPERATURE|MAX_TOKENS|REASONING_EFFORT)$/;

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
      } else if (field === 'REASONING_EFFORT') {
        const effort = raw.trim() as LlmReasoningEffort;
        if (!REASONING_EFFORTS.includes(effort)) {
          throw new Error(`${key} must be one of: ${REASONING_EFFORTS.join(', ')}`);
        }
        profile.reasoningEffort = effort;
      } else {
        setNumericField(key, field as 'TEMPERATURE' | 'MAX_TOKENS', raw, profile);
      }
    },
  });
}
