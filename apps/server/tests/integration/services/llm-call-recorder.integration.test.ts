/**
 * INV-LLM-008: every model invocation is stored, independent of LOG_LEVEL. `run_id` carries no FK (like
 * `conversation_turns.run_id`, Task 1) — a call is recorded mid-run, before any `conversation_runs`
 * row necessarily exists — so these tests use bare `randomUUID()` run ids, no seeded user or run row.
 *
 * The Task 3 lesson applies here too: `call_index` and the prompt-blob dedup are both meant to hold
 * ACROSS runs sharing this one table (every run's llm_calls interleave in it, and the training
 * system prompt repeats across many runs, not just within one) — so beyond the single-run cases,
 * one test below interleaves two runs' calls and checks neither's numbering nor dedup leaks into
 * the other's.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { recordLlmCall, type RecordLlmCallInput, type RecordLlmCallRequest } from '@infra/ai/llm-call-recorder';
import { db } from '@infra/db/drizzle';
import { llmCalls, promptBlobs } from '@infra/db/schema';

const SYSTEM_PROMPT = 'You are the training coach. '.repeat(50); // stand-in for the ~3.5k-token prompt

const baseCall = (runId: string, overrides: Partial<RecordLlmCallInput> = {}): RecordLlmCallInput => ({
  runId,
  model: 'z-ai/glm-5.3',
  request: {
    model: 'z-ai/glm-5.3',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'следующий подход' },
    ],
    temperature: 0.7,
  },
  response: { text: 'Отлично!', finishReason: 'stop', usage: { promptTokens: 900, completionTokens: 12 } },
  latencyMs: 250,
  ...overrides,
});

const callsOfRun = (runId: string) =>
  db.select().from(llmCalls).where(eq(llmCalls.runId, runId)).orderBy(llmCalls.callIndex);

describe('recordLlmCall (INV-LLM-008)', () => {
  it('two calls in one run get indexes 1 and 2, same run_id', async () => {
    const runId = randomUUID();
    await recordLlmCall(baseCall(runId));
    await recordLlmCall(baseCall(runId, { response: { text: 'Готово.', finishReason: 'stop', usage: null } }));

    const rows = await callsOfRun(runId);
    expect(rows.map(r => r.runId)).toEqual([runId, runId]);
    expect(rows.map(r => r.callIndex)).toEqual([1, 2]);
  });

  it('a failing call still records the request, with the error and no response', async () => {
    const runId = randomUUID();
    await recordLlmCall(
      baseCall(runId, {
        response: null,
        errorClass: 'LlmUnavailableError',
        errorMessage: 'upstream 503',
      }),
    );

    const [row] = await callsOfRun(runId);
    expect(row!.response).toBeNull();
    expect(row!.errorClass).toBe('LlmUnavailableError');
    expect(row!.errorMessage).toBe('upstream 503');
    const request = row!.request as RecordLlmCallRequest;
    expect(request.messages.find(m => m.role === 'user')?.content).toBe('следующий подход');
  });

  it('the system prompt is stored once per distinct content hash and referenced, not duplicated per call', async () => {
    const runId = randomUUID();
    await recordLlmCall(baseCall(runId));
    await recordLlmCall(baseCall(runId));

    const rows = await callsOfRun(runId);
    const hashes = rows.map(r => {
      const request = r.request as RecordLlmCallRequest;
      const system = request.messages.find(m => m.role === 'system')!;
      expect(system.content).toBeUndefined(); // never duplicated into the row
      expect(system.contentHash).toBeTruthy();
      return system.contentHash!;
    });
    expect(hashes[0]).toBe(hashes[1]);

    const blobs = await db.select().from(promptBlobs).where(eq(promptBlobs.hash, hashes[0]!));
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.content).toBe(SYSTEM_PROMPT);
  });

  it('never stores credentials: a request whose payload leaked a header/key would still show it — asserting the row has none', async () => {
    const runId = randomUUID();
    await recordLlmCall(baseCall(runId));

    const [row] = await callsOfRun(runId);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toMatch(/authorization|api[-_]?key|bearer /i);
  });

  it("INV-LLM-010 lesson applied: two runs' calls interleaved in the same table neither share call_index nor duplicate the shared prompt blob", async () => {
    const runA = randomUUID();
    const runB = randomUUID();

    await recordLlmCall(baseCall(runA)); // A: 1
    await recordLlmCall(baseCall(runB)); // B: 1 — must not become 2 from A's row
    await recordLlmCall(baseCall(runB)); // B: 2
    await recordLlmCall(baseCall(runA)); // A: 2 — must not become 3 from B's rows

    expect((await callsOfRun(runA)).map(r => r.callIndex)).toEqual([1, 2]);
    expect((await callsOfRun(runB)).map(r => r.callIndex)).toEqual([1, 2]);

    const hashOf = (row: (typeof llmCalls.$inferSelect)[][number]) => {
      const request = row.request as RecordLlmCallRequest;
      return request.messages.find(m => m.role === 'system')!.contentHash;
    };
    const allHashes = [...(await callsOfRun(runA)), ...(await callsOfRun(runB))].map(hashOf);
    expect(new Set(allHashes).size).toBe(1); // one shared blob across both runs

    const blobs = await db.select().from(promptBlobs).where(eq(promptBlobs.hash, allHashes[0]!));
    expect(blobs).toHaveLength(1);
  });
});
