/**
 * Prompt-caching plan T2: a real `ChatOpenAI` whose `configuration.fetch` records the serialised
 * request body and answers with a canned chat completion — the model call never leaves the process.
 * The body is what OpenRouter would receive, so a test asserts on the wire shape (message order,
 * content parts, `cache_control`), not on LangChain's in-memory messages.
 */
import { ChatOpenAI } from '@langchain/openai';

export interface WireMessage {
  role: string;
  content: string | Array<{ type: string; text?: string; cache_control?: Record<string, unknown> }> | null;
  tool_calls?: unknown;
  tool_call_id?: string;
}

export interface WireRequest {
  model: string;
  messages: WireMessage[];
  tools?: Array<{ function: { name: string } }>;
  [key: string]: unknown;
}

export interface CannedResponse {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  /** Raw provider `usage` object, passed through untouched. */
  usage?: Record<string, unknown>;
}

export function makeCapturingModel(responses: CannedResponse[] = []): { model: ChatOpenAI; requests: WireRequest[] } {
  const requests: WireRequest[] = [];
  let call = 0;
  const capturingFetch = async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
    requests.push(JSON.parse(String(init?.body)) as WireRequest);
    const canned = responses[call] ?? { content: 'ok' };
    call += 1;
    const message = {
      role: 'assistant',
      content: canned.content ?? (canned.toolCalls ? null : 'ok'),
      ...(canned.toolCalls
        ? {
            tool_calls: canned.toolCalls.map(c => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            })),
          }
        : {}),
    };
    return new Response(
      JSON.stringify({
        id: `chatcmpl-${call}`,
        object: 'chat.completion',
        created: 0,
        model: 'anthropic/claude-sonnet-5.5',
        choices: [{ index: 0, message, finish_reason: canned.toolCalls ? 'tool_calls' : 'stop' }],
        usage: canned.usage ?? { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const model = new ChatOpenAI({
    model: 'anthropic/claude-sonnet-5.5',
    apiKey: 'test-key',
    maxRetries: 0,
    configuration: { baseURL: 'http://capture.invalid/v1', fetch: capturingFetch as never },
  });
  return { model, requests };
}

/** Every `cache_control` occurrence in a request body, with where it sits. */
export interface CacheControlPart {
  messageIndex: number;
  part: Record<string, unknown>;
}

export function cacheControlParts(request: WireRequest): CacheControlPart[] {
  const found: CacheControlPart[] = [];
  request.messages.forEach((m, messageIndex) => {
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.cache_control !== undefined) {
          found.push({ messageIndex, part: part.cache_control });
        }
      }
    }
  });
  return found;
}

/** Text of a wire message, whether `content` is a string or a list of text parts. */
export function wireText(m: WireMessage): string {
  if (typeof m.content === 'string') {
    return m.content;
  }
  return (m.content ?? []).map(p => p.text ?? '').join('');
}
