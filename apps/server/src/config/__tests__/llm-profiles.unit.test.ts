import { parseLlmProfiles } from '../llm-profiles';

describe('parseLlmProfiles (AC-1314 — optional per-profile overrides)', () => {
  it('returns an empty map when no LLM_PROFILE_* variable is set', () => {
    expect(parseLlmProfiles({ LLM_MODEL: 'x', OTHER: 'y' })).toEqual({});
  });

  it('collects model, temperature and maxTokens per lower-cased profile name', () => {
    const profiles = parseLlmProfiles({
      LLM_PROFILE_SUMMARIZER_MODEL: 'z-ai/glm-5.3-flash',
      LLM_PROFILE_SUMMARIZER_TEMPERATURE: '0',
      LLM_PROFILE_JUDGE_MAX_TOKENS: '2048',
    });
    expect(profiles).toEqual({
      summarizer: { model: 'z-ai/glm-5.3-flash', temperature: 0 },
      judge: { maxTokens: 2048 },
    });
  });

  it('ignores empty values', () => {
    expect(parseLlmProfiles({ LLM_PROFILE_SUMMARIZER_MODEL: '   ' })).toEqual({});
  });

  it('rejects a non-numeric temperature and a non-integer max tokens', () => {
    expect(() => parseLlmProfiles({ LLM_PROFILE_A_TEMPERATURE: 'warm' })).toThrow(/LLM_PROFILE_A_TEMPERATURE/);
    expect(() => parseLlmProfiles({ LLM_PROFILE_A_MAX_TOKENS: '1.5' })).toThrow(/LLM_PROFILE_A_MAX_TOKENS/);
  });
});
