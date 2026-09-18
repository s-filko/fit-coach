/**
 * Compaction planning — pure (BR-LLM-001..004, ADR-0013 §3.3, D-A/D-B/D-I).
 * The rules: an episode ends by inactivity gap, committed phase transition or
 * history-budget overflow (in that precedence); the cut removes whole turns
 * (a turn starts at a HumanMessage — an AIMessage(tool_calls) and its
 * ToolMessages always travel together); a trivially short episode is trimmed
 * without a summary. No I/O and no clock — `now` and `estimate` come in as
 * data (BR-LLM-007).
 */
import { AIMessage, type BaseMessage } from '@langchain/core/messages';

import type { CompactReason } from '@domain/conversation/episode';

import { textOf } from '@infra/ai/llm.gateway';

/** Tool results are truncated at this many characters in the summariser transcript. */
const TOOL_RESULT_MAX_CHARS = 500;

/**
 * The estimation seam (D-A/D-P): pure compaction takes its measure as data.
 * The production default is `estimateMessages` from token-estimator — the
 * same definition the budget report uses, so the trigger and the report can
 * never drift apart.
 */
export type Estimate = (messages: BaseMessage[]) => number;

export interface DecideCompactInput {
  /** The two trigger inputs that live in state (D-A). */
  state: { compactReason: CompactReason | null; lastUserMessageAt: string | null };
  /** The episode history — everything before this run's HumanMessage (D-I). */
  history: BaseMessage[];
  now: Date;
  gapMs: number;
  historyBudget: number;
  estimate: Estimate;
}

/**
 * Why the episode ends, or null when it does not. Precedence (D-A):
 * phase_boundary (set by the compaction-flag transition handler) > inactivity
 * (BR-LLM-001) > budget (BR-LLM-003). Both computed triggers need a
 * non-empty history; inactivity additionally needs `lastUserMessageAt` set.
 */
export function decideCompactReason(input: DecideCompactInput): CompactReason | null {
  const { state, history, now, gapMs, historyBudget, estimate } = input;
  if (state.compactReason !== null) {
    return state.compactReason;
  }
  if (history.length === 0) {
    return null;
  }
  if (state.lastUserMessageAt !== null && now.getTime() - Date.parse(state.lastUserMessageAt) >= gapMs) {
    return 'inactivity';
  }
  if (estimate(history) > historyBudget) {
    return 'budget';
  }
  return null;
}

/** Turns of an episode: each starts at a HumanMessage; a pre-human prefix joins the first turn. */
function splitTurns(history: BaseMessage[]): BaseMessage[][] {
  const starts: number[] = [];
  history.forEach((m, i) => {
    if (m._getType() === 'human') {
      starts.push(i);
    }
  });
  if (starts.length === 0) {
    return [[...history]];
  }
  const turns: BaseMessage[][] = [];
  if (starts[0] > 0) {
    turns.push(history.slice(0, starts[0]));
  }
  starts.forEach((start, i) => {
    turns.push(history.slice(start, i + 1 < starts.length ? starts[i + 1] : history.length));
  });
  return turns;
}

export interface PlanCompactionInput {
  history: BaseMessage[];
  reason: CompactReason;
  historyBudget: number;
  estimate: Estimate;
}

/**
 * What leaves the channel and what stays. inactivity/phase_boundary end the
 * whole episode (removed = history, kept = []); budget removes the minimum
 * number of OLDEST whole turns until the kept history fits. The cut is
 * turn-safe by construction: turns are never split, so tool calls and their
 * results always travel together (D-I, master plan P4 rollback trigger).
 */
export function planCompaction(input: PlanCompactionInput): { removed: BaseMessage[]; kept: BaseMessage[] } {
  const { history, reason, historyBudget, estimate } = input;
  if (reason === 'budget') {
    const turns = splitTurns(history);
    const removed: BaseMessage[] = [];
    let kept = [...history];
    while (turns.length > 0 && estimate(kept) > historyBudget) {
      removed.push(...turns.shift()!);
      kept = turns.flat();
    }
    return { removed, kept };
  }
  return { removed: [...history], kept: [] };
}

/**
 * D-B: an ended episode with fewer than `minTurns` human turns or fewer than
 * `minTokens` estimated tokens is trimmed without a summary — a one-line
 * exchange is not worth a model call and would ride the prompt for three
 * episodes as noise.
 */
export function isShortEpisode(
  removed: BaseMessage[],
  opts: { minTurns: number; minTokens: number; estimate: Estimate },
): boolean {
  const turns = removed.filter(m => m._getType() === 'human').length;
  return turns < opts.minTurns || opts.estimate(removed) < opts.minTokens;
}

/**
 * The summariser's view of the removed episode (v2 input): one line per
 * message; tool calls as `[tool_call name(args)]`; tool results truncated at
 * 500 characters.
 */
export function renderTranscript(removed: BaseMessage[]): string {
  const lines: string[] = [];
  for (const m of removed) {
    if (m._getType() === 'human') {
      lines.push(`User: ${textOf(m.content)}`);
    } else if (m._getType() === 'ai') {
      const ai = m as AIMessage;
      const text = textOf(ai.content);
      if (text) {
        lines.push(`Assistant: ${text}`);
      }
      for (const call of ai.tool_calls ?? []) {
        lines.push(`[tool_call ${call.name}(${JSON.stringify(call.args ?? {})})]`);
      }
    } else {
      const text = textOf(m.content).slice(0, TOOL_RESULT_MAX_CHARS);
      lines.push(`Tool result: ${text}`);
    }
  }
  return lines.join('\n');
}
