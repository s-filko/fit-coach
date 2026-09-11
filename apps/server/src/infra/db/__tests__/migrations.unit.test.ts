import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const drizzleDir = path.resolve(__dirname, '../../../../drizzle');

describe('migration folder', () => {
  const journal = JSON.parse(readFileSync(path.join(drizzleDir, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };

  it('starts with the squashed baseline', () => {
    expect(journal.entries[0].tag).toBe('0000_baseline');
  });

  it('has one sql file per journal entry and no orphans', () => {
    const sqlFiles = readdirSync(drizzleDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    expect(sqlFiles).toEqual(journal.entries.map(e => `${e.tag}.sql`).sort());
  });

  it('numbers entries contiguously from zero', () => {
    expect(journal.entries.map(e => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  it('contains no destructive drop of the exercises table', () => {
    for (const entry of journal.entries) {
      const sql = readFileSync(path.join(drizzleDir, `${entry.tag}.sql`), 'utf8');
      expect(sql).not.toMatch(/DROP TABLE\s+"?exercises"?/i);
    }
  });

  it('exposes a stable sha256 per migration for stamping', () => {
    for (const entry of journal.entries) {
      const sql = readFileSync(path.join(drizzleDir, `${entry.tag}.sql`), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      expect(hash).toHaveLength(64);
    }
  });
});
