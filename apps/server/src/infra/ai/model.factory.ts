import { ChatOpenAI } from '@langchain/openai';

import { LLMLogHandler } from '@infra/ai/llm-log-handler';

import { loadConfig } from '@config/index';

const DEFAULT_MAX_TOKENS = 4096;
const models = new Map<string, ChatOpenAI>();

/**
 * The single ChatOpenAI construction site (ADR-0013 D-10, AC-1313).
 * `profile` selects optional overrides from LLM_PROFILE_<NAME>_* (config/llm-profiles.ts);
 * an unconfigured profile is identical to 'default' (AC-1314). One instance per profile.
 */
export function getModel(profile = 'default'): ChatOpenAI {
  const cached = models.get(profile);
  if (cached) {
    return cached;
  }

  const config = loadConfig();
  const override = config.LLM_PROFILES[profile] ?? {};

  const model = new ChatOpenAI({
    model: override.model ?? config.LLM_MODEL,
    temperature: override.temperature ?? config.LLM_TEMPERATURE,
    maxTokens: override.maxTokens ?? DEFAULT_MAX_TOKENS,
    apiKey: config.LLM_API_KEY,
    configuration: config.LLM_API_URL ? { baseURL: config.LLM_API_URL } : undefined,
    callbacks: [new LLMLogHandler()],
  });

  models.set(profile, model);
  return model;
}

/** Test-only: drop cached instances so env overrides can be re-read. */
export function resetModelCacheForTests(): void {
  models.clear();
}
