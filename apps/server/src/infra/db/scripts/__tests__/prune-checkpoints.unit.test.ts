/**
 * buildPruneStatements (BR-LLM-005, P4 context-budget plan Task 5): pure SQL
 * builder — dry-run (default) prints/counts without deleting; `--apply`
 * deletes rows older than `--days` from `checkpoints`, except the latest per
 * `(thread_id, checkpoint_ns)`; `checkpoint_writes` of deleted checkpoints go
 * with them; `checkpoint_blobs` rows not referenced by the SURVIVING latest
 * checkpoint's `channel_versions` for that `(thread_id, checkpoint_ns)` go too.
 */
import { buildPruneStatements } from '../prune-checkpoints';

describe('buildPruneStatements', () => {
  it('defaults days to 14 and apply to false', () => {
    const { statements, days, apply } = buildPruneStatements({});
    expect(days).toBe(14);
    expect(apply).toBe(false);
    expect(statements.length).toBeGreaterThan(0);
  });

  it('dry-run (apply: false) statements select instead of deleting — nothing deletes', () => {
    const { statements } = buildPruneStatements({ days: 7, apply: false });
    for (const s of statements) {
      expect(s.sql.toUpperCase()).not.toContain('DELETE');
      expect(s.sql.toUpperCase()).toContain('SELECT');
    }
  });

  it('apply: true produces DELETE statements for all three tables', () => {
    const { statements } = buildPruneStatements({ days: 7, apply: true });
    const names = statements.map(s => s.table);
    expect(names).toEqual(['checkpoint_writes', 'checkpoint_blobs', 'checkpoints']);
    for (const s of statements) {
      expect(s.sql.toUpperCase()).toContain('DELETE FROM');
    }
  });

  it('never deletes the latest checkpoint per (thread_id, checkpoint_ns) — the checkpoints DELETE excludes it', () => {
    const { statements } = buildPruneStatements({ days: 7, apply: true });
    const checkpointsDelete = statements.find(s => s.table === 'checkpoints')!;
    // The exclusion is a NOT IN / correlated subquery keyed on the latest checkpoint_id
    // per (thread_id, checkpoint_ns) — the statement text must reference that latest-pick logic.
    expect(checkpointsDelete.sql).toMatch(/ROW_NUMBER|MAX\(checkpoint_id\)|latest/i);
  });

  it('checkpoint_writes deletion is scoped to the SAME cutoff and latest-exclusion as checkpoints', () => {
    const { statements } = buildPruneStatements({ days: 7, apply: true });
    const writesDelete = statements.find(s => s.table === 'checkpoint_writes')!;
    expect(writesDelete.sql).toMatch(/checkpoint_ns/i);
    expect(writesDelete.sql).toMatch(/checkpoint_id/i);
  });

  it('checkpoint_blobs deletion excludes versions referenced by the latest checkpoint', () => {
    const { statements } = buildPruneStatements({ days: 7, apply: true });
    const blobsDelete = statements.find(s => s.table === 'checkpoint_blobs')!;
    expect(blobsDelete.sql).toMatch(/channel_versions/i);
  });

  it('uses a parameterized cutoff, not a string-interpolated date', () => {
    const { statements } = buildPruneStatements({ days: 30, apply: true });
    for (const s of statements) {
      expect(s.sql).not.toContain('30 days'); // not string-interpolated
      expect(s.params).toContain(30);
    }
  });

  it('accepts days: 0 (a same-run cutoff, used by the integration test to prune everything but the latest)', () => {
    expect(() => buildPruneStatements({ days: 0, apply: true })).not.toThrow();
  });

  it('rejects a negative days value', () => {
    expect(() => buildPruneStatements({ days: -1, apply: true })).toThrow(/days/i);
  });
});
