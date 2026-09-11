import { createHash } from 'crypto';

import { hashMigration, migrationsThrough, type Journal } from '../stamp-baseline';

describe('stamp-baseline', () => {
  it('hashes migration contents with sha256, matching drizzle', () => {
    const sql = 'CREATE TABLE "x" ("id" uuid);';
    expect(hashMigration(sql)).toBe(createHash('sha256').update(sql).digest('hex'));
  });

  it('selects entries up to and including the requested tag', () => {
    const journal: Journal = {
      entries: [
        { idx: 0, tag: '0000_baseline', when: 1756802083216 },
        { idx: 1, tag: '0001_catchup', when: 1775710481505 },
      ],
    };
    expect(migrationsThrough(journal, '0000_baseline').map(e => e.tag)).toEqual(['0000_baseline']);
    expect(migrationsThrough(journal, '0001_catchup').map(e => e.tag)).toEqual([
      '0000_baseline',
      '0001_catchup',
    ]);
  });

  it('throws when the requested tag is not in the journal', () => {
    const journal: Journal = { entries: [{ idx: 0, tag: '0000_baseline', when: 1756802083216 }] };
    expect(() => migrationsThrough(journal, '0009_nope')).toThrow(/0009_nope/);
  });
});
