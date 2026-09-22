/**
 * AC-AT-3 review fix (2026-09-22): every earlier test for the record either injected the recorder
 * (llm-log-handler.unit.test.ts, DB-free by design) or called `recordLlmCall` directly
 * (llm-call-recorder.integration.test.ts) — neither exercises the actual chain a production call
 * makes: a real LangChain chat model → its own emitted callbacks → LLMLogHandler (bound at
 * model.factory's construction site) → the recorder → the row. `tests/integration/scenarios/
 * scripted-model.ts`'s mock is a plain object with an `invoke` method, not a `BaseChatModel` — it
 * emits no LangChain callbacks at all, so every scenario test (npm run test:scenarios) never
 * touches this path either. This is the one test that does: `FakeListChatModel` (`@langchain/core/
 * utils/testing`) is a REAL `BaseChatModel` — deterministic, no network, but it goes through the
 * same base-class invoke/generate wrapping `ChatOpenAI` does, so it emits real
 * handleChatModelStart/handleLLMEnd callbacks with the same argument shapes. `model.factory.ts` is
 * mocked ONLY to substitute this model for the real `ChatOpenAI` construction (same reason
 * `llm.gateway.unit.test.ts` and `scripted-model.ts` both mock the same module) — the model itself,
 * `OpenAiLlmGateway`, `LLMLogHandler` and `recordLlmCall` are all real.
 *
 * Found empirically: `gateway.chat()` resolving does NOT mean the record has landed.
 * `@langchain/core`'s callback manager runs a handler that doesn't opt into `awaitHandlers`
 * through a background queue (`consumeCallback`, `singletons/callbacks.ts`) rather than awaiting it
 * inline — by design, so a slow/failing handler (a tracer, or this recorder) never adds latency or
 * risk to the model call it is watching. `awaitAllCallbacks()` is LangChain's own documented drain
 * for exactly this — the same call apps make before a serverless function exits — used here to wait
 * for the record instead of a bespoke poll.
 */
import { randomUUID } from 'node:crypto';

import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import { eq } from 'drizzle-orm';

// eslint-disable-next-line import/order -- the mock factory must precede the imports it intercepts
jest.mock('@infra/ai/model.factory', () => {
  const { FakeListChatModel } = jest.requireActual('@langchain/core/utils/testing');
  const { LLMLogHandler } = jest.requireActual('@infra/ai/llm-log-handler');
  // The same shape production wires at its one construction site (model.factory.ts):
  // a chat model with LLMLogHandler bound as its own callback, not passed per-invoke.
  const model = new FakeListChatModel({ responses: ['Отлично, продолжаем!'], callbacks: [new LLMLogHandler()] });
  return { getModel: () => model };
});

describe('a real chat model call, through the real gateway, writes an llm_calls row (AC-AT-3)', () => {
  it('records the request, the response and a reference to the deduped system prompt', async () => {
    const { OpenAiLlmGateway } = await import('@infra/ai/llm.gateway');
    const { db } = await import('@infra/db/drizzle');
    const { llmCalls, promptBlobs } = await import('@infra/db/schema');

    const gateway = new OpenAiLlmGateway();
    const runId = randomUUID();
    const systemPrompt = 'You are the training coach. '.repeat(50); // stand-in for the ~3.5k-token prompt

    const result = await gateway.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'следующий подход' },
      ],
      { runId },
    );

    // Fixture soundness: the real callback path really answered through the fake model.
    expect(result).toEqual({ content: 'Отлично, продолжаем!' });

    // The record is written by a callback LangChain runs in the background (see header) —
    // drain it before asserting, or this reads the row before it exists.
    await awaitAllCallbacks();

    const [row] = await db.select().from(llmCalls).where(eq(llmCalls.runId, runId));
    expect(row).toBeDefined();
    expect(row!.errorClass).toBeNull();
    expect(row!.latencyMs).toBeGreaterThanOrEqual(0);

    const request = row!.request as {
      messages: Array<{ role: string; content?: string; contentHash?: string }>;
    };
    const userMessage = request.messages.find(m => m.role === 'user');
    expect(userMessage?.content).toBe('следующий подход');

    // The system prompt is a reference, not inline text (AC-AT-3 dedup).
    const systemMessage = request.messages.find(m => m.role === 'system')!;
    expect(systemMessage.content).toBeUndefined();
    expect(systemMessage.contentHash).toBeTruthy();

    const blobs = await db.select().from(promptBlobs).where(eq(promptBlobs.hash, systemMessage.contentHash!));
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.content).toBe(systemPrompt);

    const response = row!.response as { text: string } | null;
    expect(response?.text).toBe('Отлично, продолжаем!');
  });
});
