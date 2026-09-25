/**
 * REPRODUCTION (RED) — session-investigation-0925 plan, Task 1, F1 /
 * AC-SI-1(a,b). Runs only via an explicit --testMatch; promoted into
 * `tool-executor.unit.test.ts` (the AC-1332 budget block) when the fix lands.
 * Do NOT edit tool-executor.unit.test.ts — its AC-1332 budget test is the
 * home test at promotion.
 *
 * F1 (tool-executor.ts:207): `countLlmErrors` sums `llm_error` ToolMessages
 * over the WHOLE `state.messages` history, with no notion of "this run" (a
 * run boundary is a `HumanMessage`). The training contract
 * (tool-policy.ts:43, `llmErrorBudget: 1`, "per run") is violated two ways:
 * (a) an error from an earlier run still counts against a later run that has
 * none of its own; (b) a batch that adds ZERO new errors can still push the
 * running total over budget and end the run.
 *
 * F3 / AC-SI-3 (R3, BUG-036 + owner language rule): originally reproduced
 * here too, expecting the fallback language to be DETECTED from what the
 * user wrote — the owner's actual rule is the opposite (profile only, never
 * per-message detection). Promoted, in its corrected form, to
 * `messages/__tests__/catalog.unit.test.ts` and removed from this file.
 *
 * Helpers below mirror tool-executor.unit.test.ts's fakeTool/stateWithCalls/
 * configWith (not exported there, so reproduced verbatim here per the plan's
 * ANCHORS note).
 */
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

import { ok } from '@domain/conversation/tool-outcome';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { buildToolExecutor } from '../tool-executor';

interface FakeTool {
  name: string;
  invoke: jest.Mock;
}

function fakeTool(name: string, impl?: jest.Mock): FakeTool {
  return { name, invoke: impl ?? jest.fn().mockResolvedValue(ok(`${name} done`)) };
}

function asTools(...fakes: FakeTool[]): StructuredToolInterface[] {
  return fakes as unknown as StructuredToolInterface[];
}

function stateWithCalls(
  calls: Array<{ name: string; args: Record<string, unknown>; id: string }>,
  extra: {
    messages?: BaseMessage[];
    userId?: string;
    activeSessionId?: string | null;
    languageCode?: string | null;
  } = {},
) {
  return {
    messages: [...(extra.messages ?? []), new AIMessage({ content: '', tool_calls: calls })],
    userId: extra.userId ?? 'user-1',
    ...(extra.activeSessionId !== undefined ? { activeSessionId: extra.activeSessionId } : {}),
    user: { languageCode: extra.languageCode === undefined ? null : extra.languageCode },
  };
}

const CTX = {
  runId: 'run-1',
  userId: 'user-1',
  user: { languageCode: null },
  now: new Date(0),
  client: 'telegram' as const,
  trigger: 'user_message' as const,
  metrics: new RunMetricsCollector('run-1'),
};

function configWith(languageCode: string | null = null): RunnableConfig {
  return {
    configurable: { thread_id: 't-1' },
    metadata: { runId: 'run-1' },
    context: { ...CTX, user: { languageCode } },
  } as never;
}

describe('tool-executor error budget — reproduction (F1 / AC-SI-1a, AC-SI-1b)', () => {
  it("AC-SI-1a: an llm_error from an EARLIER RUN (a HumanMessage sits after it) must not count toward THIS run's budget", async () => {
    // Training's real contract: llmErrorBudget: 1, "per run" (tool-policy.ts:43).
    const failing = fakeTool('log_set', jest.fn().mockRejectedValue(new Error('DB rejected the set')));
    const executor = buildToolExecutor(asTools(failing), { llmErrorBudget: 1 });

    const priorRunError = new ToolMessage({
      tool_call_id: 'old',
      content: "LLM_ERROR: an earlier run's failure",
      status: 'error',
    });
    // The run boundary: whatever comes after this HumanMessage is a NEW run.
    const runBoundary = new HumanMessage('ещё подход');

    const result = (await executor(
      stateWithCalls([{ name: 'log_set', args: { reps: 8 }, id: 'this-run' }], {
        messages: [priorRunError, runBoundary],
      }),
      configWith(null),
    )) as { messages: BaseMessage[] };

    // Desired: only THIS run's error (1) counts against budget 1 → within
    // budget, no terminal catalog message. Production counts the prior run's
    // error too (2 > 1) and wrongly ends the run — this assertion fails today.
    const last = result.messages[result.messages.length - 1];
    expect(last).not.toBeInstanceOf(AIMessage);
  });

  it('AC-SI-1b: a batch that adds ZERO new errors must never end the run with tool_error_budget_exhausted', async () => {
    const succeeding = fakeTool('log_set'); // resolves ok() by default
    const executor = buildToolExecutor(asTools(succeeding), { llmErrorBudget: 1 });

    // Two OLD errors already sit in history (over budget on their own) — but
    // this batch's own tool call succeeds; zero errors are added right now.
    const oldErrors: BaseMessage[] = [
      new ToolMessage({ tool_call_id: 'x', content: 'LLM_ERROR: old 1', status: 'error' }),
      new ToolMessage({ tool_call_id: 'y', content: 'LLM_ERROR: old 2', status: 'error' }),
    ];

    const result = (await executor(
      stateWithCalls([{ name: 'log_set', args: { reps: 8, weight: 80 }, id: 'clean' }], { messages: oldErrors }),
      configWith(null),
    )) as { messages: BaseMessage[] };

    // Desired: a batch with zero errors of its own never appends the
    // terminal catalog message. Production counts the old errors regardless
    // (2 + 0 = 2 > 1) and ends the run — this assertion fails today.
    const last = result.messages[result.messages.length - 1];
    expect(last).not.toBeInstanceOf(AIMessage);
  });
});
