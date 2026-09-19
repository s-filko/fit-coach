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

/** Text of the last AI message, null when the channel has none. */
export function lastAiText(messages: BaseMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?._getType() === 'ai') {
      return textOf(m.content);
    }
  }
  return null;
}

/**
 * The run's reply (AC-CC-3, chat-continuity Task 3 — supersedes "the reply is
 * the last AIMessage"): every non-empty AI text of the CURRENT run (from the
 * last HumanMessage on), in order, joined with one blank line — text written
 * alongside tool calls arrives too, and nothing from earlier runs is
 * re-sent. A run with a single AI message is byte-for-byte `lastAiText` over
 * that run; no AI text at all → ''.
 */
export function runAiText(messages: BaseMessage[]): string {
  const { current } = splitEpisode(messages);
  const texts: string[] = [];
  for (const m of current) {
    if (m?._getType() === 'ai') {
      const text = textOf(m.content);
      if (text !== '') {
        texts.push(text);
      }
    }
  }
  return texts.join('\n\n');
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
