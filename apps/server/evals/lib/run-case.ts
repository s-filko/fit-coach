import { randomUUID } from 'node:crypto';

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { AIMessage, type BaseMessage, ToolMessage } from '@langchain/core/messages';

import type { BudgetReport } from '@domain/conversation/ports';

import { buildConversationRunner } from '@infra/ai/graph/conversation-run.adapter';
import { buildConversationGraph } from '@infra/ai/graph/conversation.graph';

import type { EvalCase } from '../schema/case.schema';

import { buildStubDeps } from './build-stub-deps';
import { toBaseMessages } from './seed-messages';

/** One message of the last model input, reduced to what the L1 budget/orphan checks need. */
export interface ModelInputMessage {
  type: string;
  /** AIMessage: the tool_call ids it carries (empty if none). */
  toolCallIds: string[];
  /** ToolMessage: the tool_call_id it answers. */
  toolCallId?: string;
}

export interface CaseObservation {
  text: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  transition: string | null;
  outcome: string;
  threw: string | null;
  budgetReport: BudgetReport | null;
  /** The LAST model call's input, reduced (D-C — needs the model input, not just the report). */
  lastModelInput: ModelInputMessage[];
  /**
   * The LAST model call's input as text (message contents joined by newlines) —
   * what `user-facts-block-present` (AC-1361, P6 Task 6) scans for the
   * `## User Facts` heading and the fact substrings. '' when no model call was
   * made. In-memory only: never written into reports or baselines.
   */
  assembledInput: string;
}

interface ObservedToolCall {
  name: string;
  args: Record<string, unknown>;
}

function toolCallIdsOf(m: BaseMessage): string[] {
  if (!(m instanceof AIMessage)) {
    return [];
  }
  return (m.tool_calls ?? []).map(tc => tc.id).filter((id): id is string => !!id);
}

function reduceModelMessage(m: BaseMessage): ModelInputMessage {
  const toolCallId = m instanceof ToolMessage ? m.tool_call_id : undefined;
  return { type: m._getType(), toolCallIds: toolCallIdsOf(m), toolCallId };
}

/** Message content as flat text — string content verbatim, structured content JSON-encoded. */
function contentText(m: BaseMessage): string {
  return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
}

/**
 * Records the LAST model call's input messages, reduced to type + tool-call
 * pairing (D-C: `budget-within-limits` and `no-orphan-tool-message` need what
 * the model actually received, not just the report). Same
 * `BaseCallbackHandler` pattern as `ToolRecorder` — `handleChatModelStart`
 * fires once per model invocation, `messages` is `BaseMessage[][]` (LangChain
 * batches); a run never batches, so `messages[0]` is the call.
 *
 * Also keeps the call's text (`assembledInput`, AC-1361 P6 Task 6) — the
 * reduced `last` deliberately drops content, but `user-facts-block-present`
 * scans for the `## User Facts` heading and fact substrings.
 */
export class ModelInputRecorder extends BaseCallbackHandler {
  name = 'EvalModelInputRecorder';
  last: ModelInputMessage[] = [];
  lastText = '';

  handleChatModelStart(_serialized: unknown, messages: BaseMessage[][]): void {
    this.last = (messages[0] ?? []).map(reduceModelMessage);
    this.lastText = (messages[0] ?? []).map(contentText).join('\n');
  }
}

/**
 * Records every tool invocation of one eval run.
 *
 * Why a callback and not the seeded channel afterwards: the channel keeps the
 * whole episode, so reading it back cannot tell this run's calls from the
 * seeds. Callbacks observe the calls as they happen.
 */
export class ToolRecorder extends BaseCallbackHandler {
  name = 'EvalToolRecorder';
  readonly calls: ObservedToolCall[] = [];

  /**
   * Signature verified empirically against the installed @langchain/core (2026-09-13):
   *   - `serialized` does NOT carry the tool name. It is `{ lc, type, id }` where
   *     `id` is ['langchain','tools','DynamicStructuredTool'] — the class, not the tool.
   *     Reading `serialized.name` yields undefined and `id.at(-1)` yields
   *     'DynamicStructuredTool' for every tool, which would break every tools.must check.
   *   - The real tool name arrives as the 7th parameter, `runName` ('request_transition').
   *   - `input` is a JSON string of the tool arguments.
   * Keep the unused middle parameters: they are positional and cannot be skipped.
   */
  handleToolStart(
    _serialized: unknown,
    input: string,
    _runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(input);
      if (typeof parsed === 'object' && parsed !== null) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      args = { raw: input };
    }
    this.calls.push({ name: runName ?? 'unknown', args });
  }
}

const EMPTY_OBSERVATION: CaseObservation = {
  text: '',
  toolCalls: [],
  transition: null,
  outcome: 'core_error',
  threw: null,
  budgetReport: null,
  lastModelInput: [],
  assembledInput: '',
};

export async function runCase(
  testCase: EvalCase,
  extraCallbacks: BaseCallbackHandler[] = [],
): Promise<CaseObservation> {
  const { deps, recordedRuns } = buildStubDeps(testCase.fixture);
  const graph = buildConversationGraph(deps);
  const userId = '22222222-2222-4222-8222-222222222222';
  const runId = randomUUID();
  const recorder = new ToolRecorder();
  const modelInputRecorder = new ModelInputRecorder();
  const runner = buildConversationRunner({
    graph,
    userService: deps.userService,
    runService: deps.runService,
    checkpointer: deps.checkpointer,
    transcript: deps.transcript,
    extraCallbacks: [recorder, modelInputRecorder, ...extraCallbacks],
  });

  try {
    // Seed the thread's durable state (D-H): phase and activeSessionId are
    // checkpointed facts, set the LangGraph way — no test-only port surface.
    const seeded = testCase.state?.phase ?? testCase.phase;
    // The prepare node falls back to chat when phase === 'training' without an
    // activeSessionId, so every training case must carry it.
    // Same thread the adapter invokes (D-H: the adapter uses `thread_id: userId`) —
    // seeding any other thread id silently runs every case from 'registration'.
    // Awaited (P4 Task 7): un-awaited, the checkpoint write races the
    // invoke that follows and the seeds can silently vanish.
    await graph.updateState(
      { configurable: { thread_id: userId } },
      {
        phase: seeded,
        activeSessionId: testCase.state?.activeSessionId ?? null,
        // P4 Task 7: seeded episode turns ride the same `messages` channel
        // production uses — human/ai as-is, tool traffic as tool_calls+ToolMessage.
        ...(testCase.state?.messages?.length ? { messages: toBaseMessages(testCase.state.messages) } : {}),
      },
    );

    const result = await runner.run({ userId, text: testCase.input.text });

    return {
      text: result.text,
      toolCalls: recorder.calls,
      // The requested transition lands in the run row via commit; the final
      // state's pendingTransition is always null after it.
      transition: recordedRuns[0]?.transition?.toPhase ?? null,
      outcome: recordedRuns[0]?.outcome ?? 'ok',
      threw: null,
      budgetReport: recordedRuns[0]?.budgetReport ?? null,
      lastModelInput: modelInputRecorder.last,
      assembledInput: modelInputRecorder.lastText,
    };
  } catch (err) {
    return { ...EMPTY_OBSERVATION, threw: err instanceof Error ? err.message : String(err) };
  }
}
