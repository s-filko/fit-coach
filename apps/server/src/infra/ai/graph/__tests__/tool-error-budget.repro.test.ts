/**
 * REPRODUCTION (RED) — session-investigation-0925 plan, Task 1, F3 / AC-SI-3.
 * Runs only via an explicit --testMatch; promoted at R3 fix time (BUG-036 +
 * owner language rule) into the catalog language unit test. Do NOT edit
 * tool-executor.unit.test.ts here — that is R3's home test at promotion.
 *
 * AC-SI-1a/1b (F1, BUG-034) were promoted into tool-executor.unit.test.ts's
 * AC-1332 budget block by R1 and removed from this file.
 *
 * F3 (messages/catalog.ts langOf): the catalog fallback language is driven
 * ONLY by Telegram's `language_code`, never by what the user actually wrote —
 * the owner's account is `en` but the owner writes Russian, so every
 * budget-exhaustion fallback in the dev session (F1) came back in English.
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

describe('tool-executor catalog fallback language — reproduction (F3 / AC-SI-3)', () => {
  it("AC-SI-3: a user with languageCode 'en' who writes Russian gets the catalog fallback in Russian, not English", async () => {
    const failing = fakeTool('log_set', jest.fn().mockRejectedValue(new Error('DB rejected the set')));
    // budget 0: the single error this batch produces is already over budget,
    // so the run ends here — no second scripted turn needed for this repro.
    const executor = buildToolExecutor(asTools(failing), { llmErrorBudget: 0 });

    // The owner's real shape (F3 evidence): Telegram language_code is 'en',
    // but the message the user actually wrote is Russian.
    const russianTurn = new HumanMessage('сколько подходов осталось?');

    const result = (await executor(
      stateWithCalls([{ name: 'log_set', args: { reps: 8 }, id: 'r1' }], {
        messages: [russianTurn],
        languageCode: 'en',
      }),
      configWith('en'),
    )) as { messages: BaseMessage[] };

    const last = result.messages[result.messages.length - 1] as AIMessage;
    // Desired: the fallback matches what the user actually wrote in (Russian
    // — Cyrillic characters). Production picks the language from
    // ctx.user.languageCode alone ('en') and never looks at the message the
    // user actually sent — this assertion fails today (content is English).
    expect(String(last.content)).toMatch(/[а-яё]/i);
  });
});
