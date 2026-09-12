import { ChatOpenAI } from '@langchain/openai';

import { loadConfig } from '@config/index';

import { LLMLogHandler } from '@infra/ai/llm-log-handler';

let _model: ChatOpenAI | null = null;

/**
 * Returns a shared ChatOpenAI instance configured from environment.
 * Replaces LLMService — model is used directly in graph nodes.
 */
export function getModel(): ChatOpenAI {
  if (_model) {
    return _model;
  }

  const config = loadConfig();

  _model = new ChatOpenAI({
    model: config.LLM_MODEL,
    temperature: config.LLM_TEMPERATURE,
    maxTokens: 4096,
    apiKey: config.LLM_API_KEY,
    configuration: config.LLM_API_URL ? { baseURL: config.LLM_API_URL } : undefined,
    callbacks: [new LLMLogHandler()],
  });

  return _model;
}
