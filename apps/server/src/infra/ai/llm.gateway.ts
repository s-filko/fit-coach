import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { ZodType } from 'zod';

import type { LlmCallOptions, LlmGateway } from '@domain/ai/ports';
import type { ChatMsg } from '@domain/ai/types';

import { getModel } from '@infra/ai/model.factory';

import { createLogger } from '@shared/logger';

const log = createLogger('llm-gateway');

function toLangChain(messages: ChatMsg[]): BaseMessage[] {
  return messages.map(m => {
    if (m.role === 'system') {
      return new SystemMessage(m.content);
    }
    if (m.role === 'assistant') {
      return new AIMessage(m.content);
    }
    return new HumanMessage(m.content);
  });
}

/** Flattens message content to its text blocks — one home (D-F, BACKLOG consolidation). */
export function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text?: string } => typeof b === 'object' && b !== null && 'type' in b)
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('');
  }
  return '';
}

/**
 * Run-metrics binding (src/infra/ai/run-metrics.ts): `metadata.runId` ties the LLM
 * callback to a run accumulator. A job call has no run, so `runId` is written as an
 * explicit `undefined` — never omitted — so an inherited metadata.runId from an outer
 * config can never re-open an already drained run.
 */
function callConfig(opts: LlmCallOptions): { metadata: Record<string, unknown> } {
  return { metadata: { userId: opts.userId, jobId: opts.jobId, runId: opts.runId } };
}

function isSchemaFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const { name } = err as { name?: string };
  return name === 'ZodError' || name === 'OutputParserException';
}

export class OpenAiLlmGateway implements LlmGateway {
  async chat(messages: ChatMsg[], opts: LlmCallOptions = {}): Promise<{ content: string }> {
    const profile = opts.profile ?? 'default';
    const started = Date.now();
    const response = await getModel(profile).invoke(toLangChain(messages), callConfig(opts));
    log.info(
      { profile, runId: opts.runId, jobId: opts.jobId, latencyMs: Date.now() - started, kind: 'chat' },
      'LLM gateway call',
    );
    return { content: textOf(response.content) };
  }

  async structured<T>(schema: ZodType<T>, messages: ChatMsg[], opts: LlmCallOptions = {}): Promise<T> {
    const profile = opts.profile ?? 'default';
    const runnable = getModel(profile).withStructuredOutput(schema, { name: opts.schemaName ?? 'structured_output' });
    const lcMessages = toLangChain(messages);
    const started = Date.now();

    try {
      return (await runnable.invoke(lcMessages, callConfig(opts))) as T;
    } catch (err) {
      if (!isSchemaFailure(err)) {
        throw err;
      }
      log.warn(
        { profile, runId: opts.runId, jobId: opts.jobId, err },
        'Structured output failed schema — retrying once',
      );
      return (await runnable.invoke(lcMessages, callConfig(opts))) as T;
    } finally {
      log.info(
        { profile, runId: opts.runId, jobId: opts.jobId, latencyMs: Date.now() - started, kind: 'structured' },
        'LLM gateway call',
      );
    }
  }
}
