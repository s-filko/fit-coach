/**
 * Prompt-caching plan (BUG-051) D1/D6: the two explicit Anthropic cache breakpoints, applied to the assembled
 * request in ONE place (the agent node calls this after `assembleContext`, so the assembler stays pure and
 * config-free). Breakpoint 1: the last text part of the single stable SystemMessage. Breakpoint 2: the last
 * content part of the last history message (the turn before `current`) — the one that moves forward every turn.
 * Nothing after it (the current turn, in-flight messages, the post-tool nudge) is ever marked.
 *
 * Messages are copied, never mutated: the history messages are the checkpointed objects. A message whose text is
 * empty (an AIMessage that only carries tool calls) cannot hold a breakpoint — breakpoint 2 falls back to the
 * nearest earlier history message with text. Only called when `LLM_PROMPT_CACHE` is `anthropic`; with `off` the
 * request is left exactly as `assembleContext` built it (no content-part conversion either).
 */
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

export type PromptCacheTtl = '5m' | '1h';

interface CacheControl {
  type: 'ephemeral';
  ttl?: '1h';
}

export type Part = { type: string; text?: string; cache_control?: CacheControl };

/** `5m` is the provider default, so no `ttl` key is sent; `1h` is explicit. */
function cacheControlFor(ttl: PromptCacheTtl): CacheControl {
  return ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
}

/** The message's content as a fresh list of parts (a string becomes one text part). */
export function partsOf(message: BaseMessage): Part[] {
  return typeof message.content === 'string'
    ? [{ type: 'text', text: message.content }]
    : (message.content.map(part => ({ ...part })) as Part[]);
}

function hasText(message: BaseMessage): boolean {
  return partsOf(message).some(part => part.type === 'text' && typeof part.text === 'string' && part.text !== '');
}

/**
 * The ONE way the request path copies a message with new content parts (breakpoints, the `<context>` part, the
 * post-tool nudge): every field of the original that identifies or describes it is carried over, nothing is mutated —
 * history messages are the checkpointed objects. Duck-typed (_getType): jest.resetModules can re-evaluate
 * @langchain/core, breaking instanceof. An unknown role is returned as is.
 */
export function withParts(message: BaseMessage, parts: Part[]): BaseMessage {
  const content = parts as never;
  const common = {
    content,
    id: message.id,
    name: message.name,
    additional_kwargs: message.additional_kwargs,
    response_metadata: message.response_metadata,
  };
  switch (message._getType()) {
    case 'system':
      return new SystemMessage(common);
    case 'human':
      return new HumanMessage(common);
    case 'tool': {
      const tool = message as ToolMessage;
      return new ToolMessage({
        ...common,
        tool_call_id: tool.tool_call_id,
        status: tool.status,
        artifact: tool.artifact as unknown,
      });
    }
    case 'ai': {
      const ai = message as AIMessage;
      return new AIMessage({
        ...common,
        tool_calls: ai.tool_calls,
        invalid_tool_calls: ai.invalid_tool_calls,
        usage_metadata: ai.usage_metadata,
      });
    }
    default:
      return message;
  }
}

function withBreakpoint(message: BaseMessage, control: CacheControl): BaseMessage {
  const parts = partsOf(message);
  const last = parts.length - 1;
  parts[last] = { ...parts[last], cache_control: control };
  return withParts(message, parts);
}

/**
 * `messages` = [stable SystemMessage, ...history, ...current]; `currentCount` = how many trailing messages belong
 * to this run (`current.length`). Returns a new array; the input and its messages are untouched.
 */
export function applyCacheBreakpoints(
  messages: BaseMessage[],
  currentCount: number,
  ttl: PromptCacheTtl,
): BaseMessage[] {
  const control = cacheControlFor(ttl);
  const out = [...messages];
  if (out.length > 0 && out[0]._getType() === 'system' && hasText(out[0])) {
    out[0] = withBreakpoint(out[0], control);
  }
  for (let i = out.length - currentCount - 1; i >= 1; i--) {
    if (hasText(out[i])) {
      out[i] = withBreakpoint(out[i], control);
      break;
    }
  }
  return out;
}
