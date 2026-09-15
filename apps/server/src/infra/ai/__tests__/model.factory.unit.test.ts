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
