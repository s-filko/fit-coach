/**
 * Episode helpers (D-I, refactor-p4-episode-memory Task 4): pure functions
 * over the checkpointed `messages` channel. The one invariant they rely on:
 * the adapter appends exactly one HumanMessage per run and no node adds
 * another — so "this run's messages" are found by position, not by stamps.
 */
import { type BaseMessage, ToolMessage } from '@langchain/core/messages';

import type { TranscriptMessage } from '@domain/conversation/ports';

import { textOf } from '@infra/ai/message-text';
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

/**
 * The run's reply (AC-CC-3, chat-continuity Task 3 — supersedes "the reply is
 * the last AIMessage"): every non-empty AI text of the CURRENT run (from the
 * last HumanMessage on), in order, joined with one blank line — text written
 * alongside tool calls arrives too, and nothing from earlier runs is
 * re-sent. A run with a single AI message delivers exactly that message's
 * text; no AI text at all → ''.
 *
 * `fromIndex` (transition-handoff plan Task 2): cuts `current` at this index
 * before collecting texts — the looping commit's hop boundary, so a hand-off
 * run delivers only the SECOND phase's reply. Default 0 = the whole run
 * (today's behaviour, unchanged when no hop happened).
 */
export function runAiText(messages: BaseMessage[], fromIndex = 0): string {
  const { current } = splitEpisode(messages);
  const texts: string[] = [];
  for (const m of current.slice(fromIndex)) {
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

const START_TRAINING_TOOL = 'start_training_session';

function toolCallsOf(message: BaseMessage | undefined): Array<{ id?: string; name: string }> {
  return (
    (message as (BaseMessage & { tool_calls?: Array<{ id?: string; name: string }> }) | undefined)?.tool_calls ?? []
  );
}

/**
 * The training phase's memory is this workout only (coach-simplification I1). `history` is the episode before this
 * run, `current` the run itself. Hand-off run (the `start_training_session` call is in `current`) → `[]`: the
 * workout starts with this very run. Otherwise: the HumanMessage that triggered the LAST start call, then
 * everything after that call's ToolMessage(s) — the call and its result are dropped. Not found (a budget
 * compaction folded the start away) → `history` unchanged.
 */
export function workoutHistory(history: BaseMessage[], current: BaseMessage[]): BaseMessage[] {
  if (current.some(m => m._getType() === 'ai' && toolCallsOf(m).some(c => c.name === START_TRAINING_TOOL))) {
    return [];
  }
  let startIdx = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m?._getType() === 'ai' && toolCallsOf(m).some(c => c.name === START_TRAINING_TOOL)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) {
    return history;
  }
  const callIds = new Set(toolCallsOf(history[startIdx]).map(c => c.id));
  let after = startIdx + 1;
  while (after < history.length) {
    const m = history[after];
    if (m?._getType() === 'tool' && callIds.has((m as ToolMessage).tool_call_id)) {
      after += 1;
    } else {
      break;
    }
  }
  let humanIdx = -1;
  for (let i = startIdx - 1; i >= 0; i -= 1) {
    if (history[i]?._getType() === 'human') {
      humanIdx = i;
      break;
    }
  }
  const trigger = humanIdx >= 0 ? [history[humanIdx]] : [];
  return [...trigger, ...history.slice(after)];
}
