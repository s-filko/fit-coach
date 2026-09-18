/**
 * BR-LLM-005 (P4 context-budget plan Task 5): seeds three checkpoints for one
 * thread (oldest to newest), runs buildPruneStatements's DELETEs with
 * `--days 0 --apply`, and verifies the latest checkpoint survives with its
 * writes and referenced blob versions, while the older two and their writes
 * and unreferenced blobs are gone.
 * Runs under RUN_DB_TESTS=1 against the local compose DB (npm run test:integration).
 */
import { randomUUID } from 'node:crypto';

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { sql } from 'drizzle-orm';

import { db, pool } from '../../../src/infra/db/drizzle';
import { buildPruneStatements } from '../../../src/infra/db/scripts/prune-checkpoints';

const THREAD_ID = `prune-test-${Date.now()}`;
const CHECKPOINT_NS = '';

/** LangGraph checkpoint_id is a time-sortable uuid6-like string; any monotonically increasing string works for ordering here. */
function checkpointId(n: number): string {
  return `1f${n.toString().padStart(6, '0')}-0000-6000-8000-000000000000`;
}

async function seedCheckpoint(n: number, tsIso: string, channelVersions: Record<string, string>): Promise<void> {
  await db.execute(
    sql`INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata)
        VALUES (
          ${THREAD_ID}, ${CHECKPOINT_NS}, ${checkpointId(n)},
          ${JSON.stringify({ ts: tsIso, channel_versions: channelVersions })}::jsonb,
          '{}'::jsonb
        )`,
  );
}

async function seedWrite(n: number, taskId: string): Promise<void> {
  await db.execute(
    sql`INSERT INTO checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob)
        VALUES (${THREAD_ID}, ${CHECKPOINT_NS}, ${checkpointId(n)}, ${taskId}, 0, 'messages', 'json', '{}'::bytea)`,
  );
}

async function seedBlob(channel: string, version: string): Promise<void> {
  await db.execute(
    sql`INSERT INTO checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type, blob)
        VALUES (${THREAD_ID}, ${CHECKPOINT_NS}, ${channel}, ${version}, 'json', '{}'::bytea)
        ON CONFLICT DO NOTHING`,
  );
}

async function counts(): Promise<{ checkpoints: number; writes: number; blobs: number }> {
  const [c, w, b] = await Promise.all([
    db.execute(sql`SELECT count(*)::int AS n FROM checkpoints WHERE thread_id = ${THREAD_ID}`),
    db.execute(sql`SELECT count(*)::int AS n FROM checkpoint_writes WHERE thread_id = ${THREAD_ID}`),
    db.execute(sql`SELECT count(*)::int AS n FROM checkpoint_blobs WHERE thread_id = ${THREAD_ID}`),
  ]);
  const n = (r: unknown): number => (r as { rows: Array<{ n: number }> }).rows[0].n;
  return { checkpoints: n(c), writes: n(w), blobs: n(b) };
}

describe('prune-checkpoints (BR-LLM-005) — integration', () => {
  beforeAll(async () => {
    // The checkpoint_* tables are LangGraph runtime storage, created lazily by
    // PostgresSaver.setup() at app bootstrap (never via Drizzle migrations,
    // HB-01 rule) — the test DB has no organic bootstrap, so create them here
    // if they don't exist yet. A no-op against a DB that already has them.
    const connString = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
    const saver = PostgresSaver.fromConnString(connString);
    await saver.setup();
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM checkpoint_writes WHERE thread_id = ${THREAD_ID}`);
    await db.execute(sql`DELETE FROM checkpoint_blobs WHERE thread_id = ${THREAD_ID}`);
    await db.execute(sql`DELETE FROM checkpoints WHERE thread_id = ${THREAD_ID}`);
    await pool.end();
  });

  it('dry-run deletes nothing; --apply deletes older checkpoints/writes/blobs, keeps the latest', async () => {
    const oldTs = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(); // 30 days ago
    const midTs = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(); // 20 days ago
    const newTs = new Date().toISOString(); // now — the latest, must survive regardless of age

    // Checkpoint 1 (oldest): references blob version 'v1' on channel 'messages'.
    await seedCheckpoint(1, oldTs, { messages: 'v1' });
    await seedWrite(1, randomUUID());
    await seedBlob('messages', 'v1');

    // Checkpoint 2 (mid): references blob version 'v2'.
    await seedCheckpoint(2, midTs, { messages: 'v2' });
    await seedWrite(2, randomUUID());
    await seedBlob('messages', 'v2');

    // Checkpoint 3 (latest): references blob version 'v3' — this is the one that must survive.
    await seedCheckpoint(3, newTs, { messages: 'v3' });
    await seedWrite(3, randomUUID());
    await seedBlob('messages', 'v3');

    const before = await counts();
    expect(before).toEqual({ checkpoints: 3, writes: 3, blobs: 3 });

    // Dry-run: nothing deletes.
    const dryRun = buildPruneStatements({ days: 0, apply: false });
    for (const statement of dryRun.statements) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(statement.sql, statement.params);
    }
    expect(await counts()).toEqual(before);

    // --apply --days 0: every checkpoint older than "now" is a candidate except the latest.
    const applyRun = buildPruneStatements({ days: 0, apply: true });
    for (const statement of applyRun.statements) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(statement.sql, statement.params);
    }

    const after = await counts();
    expect(after.checkpoints).toBe(1);
    expect(after.writes).toBe(1);
    expect(after.blobs).toBe(1); // only 'v3' (referenced by the surviving checkpoint) remains

    const remaining = await db.execute(sql`SELECT checkpoint_id FROM checkpoints WHERE thread_id = ${THREAD_ID}`);
    expect((remaining as unknown as { rows: Array<{ checkpoint_id: string }> }).rows[0].checkpoint_id).toBe(
      checkpointId(3),
    );

    const remainingBlob = await db.execute(sql`SELECT version FROM checkpoint_blobs WHERE thread_id = ${THREAD_ID}`);
    expect((remainingBlob as unknown as { rows: Array<{ version: string }> }).rows[0].version).toBe('v3');
  });
});
