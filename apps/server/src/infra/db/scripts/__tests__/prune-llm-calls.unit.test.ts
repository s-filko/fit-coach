import { buildPruneLlmCallsStatements } from '../prune-llm-calls';

describe('buildPruneLlmCallsStatements (AC-AT-6)', () => {
  it('returns two statements, llm_calls then prompt_blobs, both parametrized by the same days', () => {
    const { statements } = buildPruneLlmCallsStatements({ days: 30 });
    expect(statements.map(s => s.table)).toEqual(['llm_calls', 'prompt_blobs']);
    expect(statements.map(s => s.params)).toEqual([[30], [30]]);
  });

  describe('llm_calls statement', () => {
    it('dry run: counts rows past the cutoff with a payload, changes nothing', () => {
      const [calls] = buildPruneLlmCallsStatements({ days: 30 }).statements;
      expect(calls!.sql).toMatch(/^SELECT count\(\*\) FROM llm_calls/i);
      expect(calls!.sql).not.toMatch(/UPDATE|DELETE/i);
      expect(calls!.sql).toContain('created_at < now() - make_interval(days => $1::int)');
      expect(calls!.params).toEqual([30]);
    });

    it('apply: nulls request and response only, never deletes the row or touches prompt_hashes', () => {
      const [calls] = buildPruneLlmCallsStatements({ days: 7, apply: true }).statements;
      expect(calls!.sql).toMatch(/^UPDATE llm_calls SET request = NULL, response = NULL/i);
      expect(calls!.sql).not.toMatch(/DELETE/i);
      // Metadata columns — including prompt_hashes — never appear on the left of an assignment.
      expect(calls!.sql).not.toMatch(
        /run_id\s*=|call_index\s*=|model\s*=|latency_ms\s*=|error_class\s*=|error_message\s*=|prompt_hashes\s*=/i,
      );
      expect(calls!.params).toEqual([7]);
    });

    it('skips rows whose payload is already null, so a second run is a no-op', () => {
      const [calls] = buildPruneLlmCallsStatements({ days: 30, apply: true }).statements;
      expect(calls!.sql).toContain('(request IS NOT NULL OR response IS NOT NULL)');
    });
  });

  describe('prompt_blobs statement', () => {
    it('dry run: counts blobs no live row (request present, inside the window) still references', () => {
      const [, blobs] = buildPruneLlmCallsStatements({ days: 30 }).statements;
      expect(blobs!.sql).toMatch(/^SELECT count\(\*\) FROM prompt_blobs/i);
      expect(blobs!.sql).not.toMatch(/UPDATE|DELETE/i);
      expect(blobs!.sql).toContain('llm_calls.request IS NOT NULL');
      expect(blobs!.params).toEqual([30]);
    });

    it('apply: nulls content only, never deletes the blob row', () => {
      const [, blobs] = buildPruneLlmCallsStatements({ days: 30, apply: true }).statements;
      expect(blobs!.sql).toMatch(/^UPDATE prompt_blobs SET content = NULL/i);
      expect(blobs!.sql).not.toMatch(/DELETE/i);
      expect(blobs!.sql).not.toMatch(/hash\s*=|created_at\s*=/i);
    });

    it('review defect 1: uses NOT EXISTS, never NOT IN — a NULL array element must not silently disable the whole prune', () => {
      const [, blobs] = buildPruneLlmCallsStatements({ days: 30, apply: true }).statements;
      expect(blobs!.sql).toMatch(/NOT EXISTS/i);
      expect(blobs!.sql).not.toMatch(/NOT IN\s*\(/i);
    });

    it('as-users-grow: the referenced-check is array containment (`@>`), not `unnest(...) = ...` — the shape the planner can serve from the GIN index on llm_calls.prompt_hashes', () => {
      const [, blobs] = buildPruneLlmCallsStatements({ days: 30, apply: true }).statements;
      expect(blobs!.sql).toContain('llm_calls.prompt_hashes @> ARRAY[prompt_blobs.hash]');
      expect(blobs!.sql).not.toMatch(/unnest/i);
    });

    it('review defect 2: takes `days` and applies the SAME cutoff dry run and apply use, so a live row that has not been pruned yet still counts as a referencer only when it is genuinely inside the window', () => {
      const dryRun = buildPruneLlmCallsStatements({ days: 15 }).statements[1]!;
      const apply = buildPruneLlmCallsStatements({ days: 15, apply: true }).statements[1]!;
      expect(dryRun.params).toEqual([15]);
      expect(apply.params).toEqual([15]);
      // Same liveness predicate in both modes — only the outer SELECT-count vs UPDATE differs.
      const referencedClause =
        /WHERE llm_calls\.prompt_hashes @> ARRAY\[prompt_blobs\.hash\][\s\S]*?created_at >= now\(\) - make_interval\(days => \$1::int\)/i;
      expect(dryRun.sql).toMatch(referencedClause);
      expect(apply.sql).toMatch(referencedClause);
    });
  });

  it('rejects a negative window', () => {
    expect(() => buildPruneLlmCallsStatements({ days: -1 })).toThrow(/non-negative/);
  });
});
