/**
 * AC-AT-6: the prune drops `llm_calls.request`/`response` past the retention window and keeps every
 * other column — `run_id`, `call_index`, `model`, `latency_ms`, `error_class`, `error_message`,
 * `created_at`, `prompt_hashes` — forever. Per the Task 3/4 lesson (a global operation needs a
 * global test): seeds rows across FOUR runs with mixed ages, not one, and checks the cutoff is
 * applied per row, not per run.
 *
 * Review finding (2026-09-22): an earlier version of this test asserted `prompt_blobs` untouched —
 * wrong, because most blobs are NOT the one static, reusable prompt (assemble-context.ts pushes up
 * to six SystemMessages per call, most of which change nearly every call). The specific trap this
 * test proves both halves of in ONE prune run: a blob referenced by a PRUNED row AND a LIVE
 * (unpruned) row keeps its content — sharing must not cost the live row its context — while a blob
 * referenced ONLY by rows that are now pruned loses its content, never its row.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { db, pool } from '@infra/db/drizzle';
import { llmCalls, promptBlobs } from '@infra/db/schema';

import { buildPruneLlmCallsStatements } from '../../../src/infra/db/scripts/prune-llm-calls';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = () => new Date();
const daysAgo = (n: number) => new Date(now().getTime() - n * DAY_MS);

async function seedCall(overrides: {
  runId: string;
  callIndex: number;
  createdAt: Date;
  promptHashes?: string[];
  request?: unknown;
  response?: unknown;
}) {
  const promptHashes = overrides.promptHashes ?? [];
  await db.insert(llmCalls).values({
    runId: overrides.runId,
    callIndex: overrides.callIndex,
    model: 'z-ai/glm-5.3',
    request: overrides.request ?? {
      model: 'z-ai/glm-5.3',
      messages: [
        ...promptHashes.map(contentHash => ({ role: 'system', contentHash })),
        { role: 'user', content: 'следующий подход' },
      ],
    },
    response: overrides.response ?? { text: 'ok', finishReason: 'stop', usage: null },
    promptHashes,
    latencyMs: 250,
    createdAt: overrides.createdAt,
  });
}

const rowFor = async (runId: string, callIndex: number) => {
  const [row] = await db
    .select()
    .from(llmCalls)
    .where(sql`${llmCalls.runId} = ${runId} AND ${llmCalls.callIndex} = ${callIndex}`);
  return row!;
};

const blobFor = async (hash: string) => {
  const [blob] = await db.select().from(promptBlobs).where(eq(promptBlobs.hash, hash));
  return blob!;
};

describe('llm_calls / prompt_blobs retention (AC-AT-6)', () => {
  const runOld1 = randomUUID();
  const runOld2 = randomUUID();
  const runRecent = randomUUID();
  // Referenced by a pruned row (runOld1) AND a live one (runRecent) — must survive.
  const sharedHash = 'a'.repeat(64);
  // Referenced only by a pruned row (runOld2) — must lose its content.
  const onlyPrunedHash = 'b'.repeat(64);

  beforeAll(async () => {
    await db
      .insert(promptBlobs)
      .values([
        { hash: sharedHash, content: 'RULES: shared static block.' },
        { hash: onlyPrunedHash, content: 'CLIENT PROFILE: only ever used by an old call.' },
      ])
      .onConflictDoNothing();

    // Run 1: one call well past a 30-day window, referencing the shared blob.
    await seedCall({ runId: runOld1, callIndex: 1, createdAt: daysAgo(40), promptHashes: [sharedHash] });
    // Run 1's SECOND call, well inside the window — same run, must not be pruned just because the
    // run has an old call too (the cutoff is per row).
    await seedCall({ runId: runOld1, callIndex: 2, createdAt: daysAgo(2) });

    // Run 2: a totally different, much older run — its blob has no other referencer.
    await seedCall({ runId: runOld2, callIndex: 1, createdAt: daysAgo(100), promptHashes: [onlyPrunedHash] });

    // Run 3: entirely recent, untouched by any retention window used below — ALSO references the
    // shared blob, which is exactly what must keep it alive.
    await seedCall({ runId: runRecent, callIndex: 1, createdAt: daysAgo(1), promptHashes: [sharedHash] });

    const { statements } = buildPruneLlmCallsStatements({ days: 30, apply: true });
    for (const statement of statements) {
      // eslint-disable-next-line no-await-in-loop -- order matters: blobs depends on calls having run first
      await pool.query(statement.sql, statement.params);
    }
  });

  it('drops the payload of a row past the window, keeping every other column including prompt_hashes', async () => {
    const row = await rowFor(runOld1, 1);
    expect(row.request).toBeNull();
    expect(row.response).toBeNull();
    expect(row.runId).toBe(runOld1);
    expect(row.callIndex).toBe(1);
    expect(row.model).toBe('z-ai/glm-5.3');
    expect(row.latencyMs).toBe(250);
    expect(row.promptHashes).toEqual([sharedHash]);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('drops a much older row in a completely different run the same way', async () => {
    const row = await rowFor(runOld2, 1);
    expect(row.request).toBeNull();
    expect(row.response).toBeNull();
    expect(row.promptHashes).toEqual([onlyPrunedHash]);
  });

  it('leaves a row inside the window untouched, even when its own run has an older, pruned call', async () => {
    const row = await rowFor(runOld1, 2);
    expect(row.request).not.toBeNull();
    expect(row.response).not.toBeNull();
  });

  it('leaves an entirely recent run untouched', async () => {
    const row = await rowFor(runRecent, 1);
    expect(row.request).not.toBeNull();
    expect(row.response).not.toBeNull();
  });

  it('keeps the content of a blob shared by a pruned row and a live row', async () => {
    const blob = await blobFor(sharedHash);
    expect(blob.content).toBe('RULES: shared static block.');
  });

  it('drops the content of a blob referenced only by rows that are now pruned, but keeps the row', async () => {
    const blob = await blobFor(onlyPrunedHash);
    expect(blob).toBeDefined();
    expect(blob.content).toBeNull();
  });

  it('a second prune run is a no-op (no error, nothing left for either statement to touch)', async () => {
    const { statements } = buildPruneLlmCallsStatements({ days: 30, apply: true });
    for (const statement of statements) {
      // eslint-disable-next-line no-await-in-loop
      const result = await pool.query(statement.sql, statement.params);
      expect(result.rowCount).toBe(0);
    }
  });
});
