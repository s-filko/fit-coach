import type { ZodType } from 'zod';

import type { ChatMsg } from '@domain/ai/types';

/**
 * The one LLM access port for non-graph callers — ADR-0013 §7 (D-10).
 * LangChain-free on purpose (INV-CONV-004): messages are the domain's ChatMsg,
 * results are plain data. Graph subgraphs keep using getModel().bindTools until P3.
 */
export interface LlmCallOptions {
  /** Model profile (config LLM_PROFILE_<NAME>_*); default 'default'. */
  profile?: string;
  /** Conversation run this call belongs to. Binds the call to run metrics. */
  runId?: string;
  /** Background job id when there is no conversation run. */
  jobId?: string;
  /** Debug-log correlation only. */
  userId?: string;
  /** structured(): name of the schema as presented to the model. */
  schemaName?: string;
}

export interface LlmGateway {
  chat(messages: ChatMsg[], opts?: LlmCallOptions): Promise<{ content: string }>;
  structured<T>(schema: ZodType<T>, messages: ChatMsg[], opts?: LlmCallOptions): Promise<T>;
}

export const LLM_GATEWAY_TOKEN = Symbol('LlmGateway');
