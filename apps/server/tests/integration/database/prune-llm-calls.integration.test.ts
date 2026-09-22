/**
 * AC-AT-6: the prune drops `llm_calls.request`/`response` past the retention window and keeps every
 * other column — `run_id`, `call_index`, `model`, `latency_ms`, `error_class`, `error_message`,
 * `created_at` — forever. Per the Task 3/4 lesson (a global operation needs a global test): seeds
 * rows across THREE runs with mixed ages, not one, and checks the cutoff is applied per row, not
 * per run. `prompt_blobs` is asserted untouched — see prune-llm-calls.ts's header for why it is
 * deliberately never garbage-collected here.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { db, pool } from '@infra/db/drizzle';
import { llmCalls, promptBlobs } from '@infra/db/schema';

import { buildPruneLlmCallsStatement } from '../../../src/infra/db/scripts/prune-llm-calls';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = () => new Date();
const daysAgo = (n: number) => new Date(now().getTime() - n * DAY_MS);

async function seedCall(overrides: {
  runId: string;
  callIndex: number;
  createdAt: Date;
  request?: unknown;
  response?: unknown;
}) {
  await db.insert(llmCalls).values({
    runId: overrides.runId,
    callIndex: overrides.callIndex,
    model: 'z-ai/glm-5.3',
    request: overrides.request ?? { model: 'z-ai/glm-5.3', messages: [{ role: 'user', content: 'hi' }] },
    response: overrides.response ?? { text: 'ok', finishReason: 'stop', usage: null },
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

describe('llm_calls payload retention (AC-AT-6)', () => {
  const runOld1 = randomUUID();
  const runOld2 = randomUUID();
  const runRecent = randomUUID();
  const sharedHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  beforeAll(async () => {
    await db.insert(promptBlobs).values({ hash: sharedHash, content: 'You are the coach.' }).onConflictDoNothing();

    // Run 1: one call well past a 30-day window (its system message references the shared blob).
    await seedCall({
      runId: runOld1,
      callIndex: 1,
      createdAt: daysAgo(40),
      request: { model: 'z-ai/glm-5.3', messages: [{ role: 'system', contentHash: sharedHash }] },
    });
    // Run 1's SECOND call, well inside the window — same run, must not be pruned just because the
    // run has an old call too (the cutoff is per row).
    await seedCall({ runId: runOld1, callIndex: 2, createdAt: daysAgo(2) });

    // Run 2: a totally different, much older run.
    await seedCall({ runId: runOld2, callIndex: 1, createdAt: daysAgo(100) });

    // Run 3: entirely recent, untouched by any retention window used below.
    await seedCall({ runId: runRecent, callIndex: 1, createdAt: daysAgo(1) });

    const { sql: pruneSql, params } = buildPruneLlmCallsStatement({ days: 30, apply: true });
    await pool.query(pruneSql, params);
  });

  it('drops the payload of a row past the window, keeping every other column', async () => {
    const row = await rowFor(runOld1, 1);
    expect(row.request).toBeNull();
    expect(row.response).toBeNull();
    expect(row.runId).toBe(runOld1);
    expect(row.callIndex).toBe(1);
    expect(row.model).toBe('z-ai/glm-5.3');
    expect(row.latencyMs).toBe(250);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('drops a much older row in a completely different run the same way', async () => {
    const row = await rowFor(runOld2, 1);
    expect(row.request).toBeNull();
    expect(row.response).toBeNull();
    expect(row.model).toBe('z-ai/glm-5.3');
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

  it('never touches prompt_blobs, even for a blob whose only referencing row just had its payload dropped', async () => {
    const blobs = await db.select().from(promptBlobs).where(eq(promptBlobs.hash, sharedHash));
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.content).toBe('You are the coach.');
  });

  it('a second prune run is a no-op on already-pruned rows (no error, nothing left to touch)', async () => {
    const { sql: pruneSql, params } = buildPruneLlmCallsStatement({ days: 30, apply: true });
    const result = await pool.query(pruneSql, params);
    expect(result.rowCount).toBe(0);
  });
});
