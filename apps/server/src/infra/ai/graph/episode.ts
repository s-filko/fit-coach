/**
 * Episode helpers (D-I, refactor-p4-episode-memory Task 4): pure functions
 * over the checkpointed `messages` channel. The one invariant they rely on:
 * the adapter appends exactly one HumanMessage per run and no node adds
 * another — so "this run's messages" are found by position, not by stamps.
 */
import { type BaseMessage, ToolMessage } from '@langchain/core/messages';

import type { TranscriptMessage } from '@domain/conversation/ports';

import { textOf } from '@infra/ai/llm.gateway';
import { outcomeKindOf } from '@infra/ai/tools/outcome';

/**
 * Splits the channel into the episode history (everything before this run's
 * HumanMessage) and the current run (`current` starts at the LAST HumanMessage;
 * empty when there is none). Commit projects only `current`; compact never
 * cuts into it.
 */
export function splitEpisode(messages: BaseMessage[]): { history: BaseMessage[]; current: BaseMessage[] } {
  let lastHuman = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?._getType() === 'human') {
      lastHuman = i;
      break;
    }
  }
  if (lastHuman < 0) {
    return { history: [...messages], current: [] };
  }
  return { history: messages.slice(0, lastHuman), current: messages.slice(lastHuman) };
}

/** Text of the last AI message, null when the channel has none (the reply is the last AIMessage — ADR-0013 §3.2). */
export function lastAiText(messages: BaseMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?._getType() === 'ai') {
      return textOf(m.content);
    }
  }
  return null;
}

/** infra → domain mapping for the transcript projection (commit is its only caller). */
export function toTranscriptMessages(messages: BaseMessage[]): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  for (const m of messages) {
    const type = m._getType();
    if (type === 'human') {
      out.push({ kind: 'human', text: textOf(m.content) });
    } else if (type === 'ai') {
      const ai = m as BaseMessage & {
        content: unknown;
        tool_calls?: Array<{ id: string; name: string; args: unknown }>;
      };
      out.push({
        kind: 'ai',
        text: textOf(ai.content),
        ...(ai.tool_calls && ai.tool_calls.length > 0
          ? { toolCalls: ai.tool_calls.map(c => ({ id: c.id, name: c.name, args: c.args })) }
          : {}),
      });
    } else if (type === 'tool') {
      const tool = m as ToolMessage;
      out.push({
        kind: 'tool_result',
        toolCallId: tool.tool_call_id,
        text: textOf(tool.content),
        status: outcomeKindOf(tool) === 'ok' ? 'ok' : 'error',
      });
    }
  }
  return out;
}
