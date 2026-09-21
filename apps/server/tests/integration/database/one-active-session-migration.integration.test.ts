/**
 * Migration 0009 (INV-TRAINING-002): the partial unique index is preceded by a hand-written guard that
 * ABORTS, naming the users, when duplicates already exist — it must never delete or close history.
 *
 * Everything below runs inside one transaction on a dedicated connection and is ROLLED BACK: the
 * shared test schema is left exactly as the global setup built it.
 */
import { readFile } from 'fs/promises';
import path from 'path';

import { Pool, type PoolClient } from 'pg';

const INDEX = 'uq_workout_sessions_one_in_progress_per_user';

describe('migration 0009 — one in_progress session per user', () => {
  let pool: Pool;
  let client: PoolClient;
  let migrationSql: string;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.DB_HOST!,
      user: process.env.DB_USER!,
      password: process.env.DB_PASSWORD!,
      database: process.env.DB_NAME!,
      port: Number(process.env.DB_PORT),
    });
    migrationSql = await readFile(path.resolve(process.cwd(), 'drizzle/0009_living_salo.sql'), 'utf8');
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  afterAll(async () => {
    await pool.end();
  });

  const insertUser = async (): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO users (first_name) VALUES ('Mig') RETURNING id`);
    return rows[0].id;
  };

  const insertInProgress = async (userId: string): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO workout_sessions (user_id, status, started_at) VALUES ($1, 'in_progress', now()) RETURNING id`,
      [userId],
    );
    return rows[0].id;
  };

  it('the index exists in the migrated schema and is partial on in_progress', async () => {
    const { rows } = await client.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [
      INDEX,
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE/);
    expect(rows[0].indexdef).toMatch(/WHERE .*status.* = 'in_progress'/);
  });

  it('applied to a database that already holds duplicates: aborts naming the user and both sessions, changes nothing', async () => {
    await client.query(`DROP INDEX ${INDEX}`);
    const userId = await insertUser();
    const first = await insertInProgress(userId);
    const second = await insertInProgress(userId);

    await client.query('SAVEPOINT before_migration');
    const failure = await client.query(migrationSql).then(
      () => null,
      (err: Error) => err,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_migration');

    expect(failure).not.toBeNull();
    expect(failure!.message).toContain('INV-TRAINING-002');
    expect(failure!.message).toContain(userId);
    expect(failure!.message).toContain(first);
    expect(failure!.message).toContain(second);
    const { rows } = await client.query(`SELECT status FROM workout_sessions WHERE user_id = $1`, [userId]);
    expect(rows.map(r => r.status)).toEqual(['in_progress', 'in_progress']);
    const idx = await client.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [INDEX]);
    expect(idx.rowCount).toBe(0);
  });

  it('applied to clean data: creates the index', async () => {
    await client.query(`DROP INDEX ${INDEX}`);
    const userId = await insertUser();
    await insertInProgress(userId);

    await client.query(migrationSql);

    const idx = await client.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [INDEX]);
    expect(idx.rowCount).toBe(1);
  });
});
