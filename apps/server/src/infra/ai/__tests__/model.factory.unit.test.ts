import { getModel, resetModelCacheForTests } from '../model.factory';

const PROFILE_VARS = [
  'LLM_PROFILE_SUMMARIZER_MODEL',
  'LLM_PROFILE_SUMMARIZER_TEMPERATURE',
  'LLM_PROFILE_SUMMARIZER_MAX_TOKENS',
];

describe('getModel(profile) (AC-1314 — no LLM_PROFILE_* means identical to defaults)', () => {
  beforeEach(() => {
    for (const v of PROFILE_VARS) {
      delete process.env[v];
    }
    resetModelCacheForTests();
  });

  it('falls back to LLM_MODEL / LLM_TEMPERATURE for an unconfigured profile', () => {
    const def = getModel();
    const summarizer = getModel('summarizer');
    expect(summarizer.model).toBe(def.model);
    expect(summarizer.model).toBe(process.env.LLM_MODEL);
    expect(summarizer.temperature).toBe(def.temperature);
  });

  it('applies LLM_PROFILE_<NAME>_* overrides to that profile only', () => {
    process.env.LLM_PROFILE_SUMMARIZER_MODEL = 'vendor/tiny-model';
    process.env.LLM_PROFILE_SUMMARIZER_TEMPERATURE = '0';
    resetModelCacheForTests();
    expect(getModel('summarizer').model).toBe('vendor/tiny-model');
    expect(getModel('summarizer').temperature).toBe(0);
    expect(getModel().model).toBe(process.env.LLM_MODEL);
  });

  it('caches one instance per profile', () => {
    expect(getModel('summarizer')).toBe(getModel('summarizer'));
    expect(getModel('summarizer')).not.toBe(getModel());
    expect(getModel()).toBe(getModel('default'));
  });
});

describe('getModel(profile) (AC-RL-1 — cap and reasoning depth from config, asserted on the request payload)', () => {
  const EFFORT_VARS = [
    'LLM_MAX_TOKENS',
    'LLM_REASONING_EFFORT',
    'LLM_PROFILE_SUMMARIZER_MAX_TOKENS',
    'LLM_PROFILE_SUMMARIZER_REASONING_EFFORT',
  ];

  beforeEach(() => {
    for (const v of EFFORT_VARS) {
      delete process.env[v];
    }
    resetModelCacheForTests();
  });

  it('defaults to max_tokens 16384 and reasoning_effort low in the request body', () => {
    const params = getModel().invocationParams() as Record<string, unknown>;
    expect(params['max_tokens']).toBe(16384);
    expect(params['reasoning_effort']).toBe('low');
  });

  it('honours LLM_MAX_TOKENS / LLM_REASONING_EFFORT from the environment', () => {
    process.env.LLM_MAX_TOKENS = '8192';
    process.env.LLM_REASONING_EFFORT = 'high';
    const params = getModel().invocationParams() as Record<string, unknown>;
    expect(params['max_tokens']).toBe(8192);
    expect(params['reasoning_effort']).toBe('high');
  });

  it('a profile override wins over the global value', () => {
    process.env.LLM_REASONING_EFFORT = 'high';
    process.env.LLM_PROFILE_SUMMARIZER_MAX_TOKENS = '2048';
    process.env.LLM_PROFILE_SUMMARIZER_REASONING_EFFORT = 'max';
    const params = getModel('summarizer').invocationParams() as Record<string, unknown>;
    expect(params['max_tokens']).toBe(2048);
    expect(params['reasoning_effort']).toBe('max');
    // the default profile keeps the global values
    const globalParams = getModel().invocationParams() as Record<string, unknown>;
    expect(globalParams['reasoning_effort']).toBe('high');
  });

  it("omits reasoning_effort entirely for 'off' (providers that reject the field)", () => {
    process.env.LLM_REASONING_EFFORT = 'off';
    const params = getModel().invocationParams() as Record<string, unknown>;
    expect('reasoning_effort' in params).toBe(false);
  });
});
