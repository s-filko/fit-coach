import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { ZodType } from 'zod';

import type { LlmCallOptions, LlmGateway } from '@domain/ai/ports';
import type { ChatMsg } from '@domain/ai/types';

import { getModel } from '@infra/ai/model.factory';
import {
  buildJsonSchemaResponseFormat,
  buildSchemaInstruction,
  extractJsonPayload,
  parseJsonOrUndefined,
} from '@infra/ai/structured-json';

import { loadConfig } from '@config/index';

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
  // A schema failure is the ZodError our own validation throws: the model's
  // answer (direct JSON, fenced JSON, or prose-recovered JSON — BUG-017) did
  // not satisfy the schema, or contained no JSON at all. The gateway parses
  // the raw answer itself (parseJsonOrUndefined swallows SyntaxError), so no
  // SyntaxError ever reaches here. Provider errors (network/auth) never reach
  // validation and propagate untouched.
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

  /**
   * BUG-017: we send the same json_schema request `withStructuredOutput` builds
   * (see `buildJsonSchemaResponseFormat`) but parse the answer ourselves. The
   * SDK-side parse throws on a fenced answer before any message exists; here a
   * fenced (or prose-wrapped) payload that passes the SAME schema is recovered
   * from the raw model answer with no second model call, and only an
   * unrecoverable/invalid answer gets today's single retry.
   */
  async structured<T>(schema: ZodType<T>, messages: ChatMsg[], opts: LlmCallOptions = {}): Promise<T> {
    const profile = opts.profile ?? 'default';
    const schemaName = opts.schemaName ?? 'structured_output';
    // LLM_STRUCTURED_OUTPUT_MODE (Z.AI route, 2026-09-19): 'json_schema' sends
    // today's request, byte-identical. 'json_object' is for providers that
    // ignore json_schema (GLM via Z.AI) — response_format {type:'json_object'}
    // plus one trailing system message carrying the JSON Schema. In both modes
    // the raw answer comes back through create() and is parsed/recovered/
    // validated by the BUG-017 code below, unchanged.
    const jsonObjectMode = loadConfig().LLM_STRUCTURED_OUTPUT_MODE === 'json_object';
    const model = getModel(profile).withConfig({
      response_format: jsonObjectMode ? { type: 'json_object' } : buildJsonSchemaResponseFormat(schema, schemaName),
    });
    const lcMessages = jsonObjectMode
      ? [...toLangChain(messages), new SystemMessage(buildSchemaInstruction(schema, schemaName))]
      : toLangChain(messages);
    const started = Date.now();

    const attempt = async (): Promise<T> => {
      const response = await model.invoke(lcMessages, callConfig(opts));
      const text = textOf(response.content);
      const direct = parseJsonOrUndefined(text);
      const payload = direct !== undefined ? direct : extractJsonPayload(text);
      const result = schema.safeParse(payload);
      if (!result.success) {
        throw result.error;
      }
      if (direct === undefined) {
        log.warn(
          { profile, runId: opts.runId, jobId: opts.jobId, recovery: 'fenced-json' },
          'Structured output recovered the JSON payload from the raw model answer',
        );
      }
      return result.data;
    };

    try {
      return await attempt();
    } catch (err) {
      if (!isSchemaFailure(err)) {
        throw err;
      }
      log.warn(
        { profile, runId: opts.runId, jobId: opts.jobId, err },
        'Structured output failed schema — retrying once',
      );
      return await attempt();
    } finally {
      log.info(
        { profile, runId: opts.runId, jobId: opts.jobId, latencyMs: Date.now() - started, kind: 'structured' },
        'LLM gateway call',
      );
    }
  }
}
