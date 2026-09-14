import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

import pg from 'pg';

export interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

export interface Journal {
  entries: JournalEntry[];
}

export function hashMigration(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function migrationsThrough(journal: Journal, tag: string): JournalEntry[] {
  const idx = journal.entries.findIndex(e => e.tag === tag);
  if (idx === -1) {throw new Error(`Migration tag not found in journal: ${tag}`);}
  return journal.entries.slice(0, idx + 1);
}

// `drizzleDir` is passed in rather than derived: this is an ESM package
// ("type": "module"), so `__dirname` does not exist at runtime, and the CLI
// wrapper resolves the path from `import.meta.url` instead.
export async function stampBaseline(through: string, drizzleDir: string): Promise<void> {
  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();

  try {
    const existing = await client.query<{ present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) AS present;
    `);

    if (existing.rows[0].present) {
      const count = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations;');
      if (count.rows[0].n > 0) {
        // eslint-disable-next-line no-console -- CLI script progress output
        console.log(`Migration history already present (${count.rows[0].n} rows) — nothing to stamp.`);
        return;
      }
    }

    // Refuse to stamp an empty database: there is nothing to pretend was applied.
    const tables = await client.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE 'checkpoint%';
    `);
    if (tables.rows[0].n === 0) {
      // eslint-disable-next-line no-console -- CLI script progress output
      console.log('Empty database — skipping stamp so migrations apply normally.');
      return;
    }

    const journal = JSON.parse(readFileSync(path.join(drizzleDir, 'meta/_journal.json'), 'utf8')) as Journal;
    const entries = migrationsThrough(journal, through);

    await client.query('BEGIN');
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle;');
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      );
    `);
    for (const entry of entries) {
      const sql = readFileSync(path.join(drizzleDir, `${entry.tag}.sql`), 'utf8');
      await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2);', [
        hashMigration(sql),
        entry.when,
      ]);
    }
    await client.query('COMMIT');
    // eslint-disable-next-line no-console -- CLI script progress output
    console.log(`Stamped ${entries.length} migration(s) through ${through}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}
