import { buildPruneLlmCallsStatements } from '../prune-llm-calls';

describe('buildPruneLlmCallsStatements (AC-AT-6)', () => {
  it('returns two statements, llm_calls first then prompt_blobs — the blob pass depends on the calls pass', () => {
    const { statements } = buildPruneLlmCallsStatements({ days: 30 });
    expect(statements.map(s => s.table)).toEqual(['llm_calls', 'prompt_blobs']);
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
    it('dry run: counts blobs unreferenced by any unpruned row, changes nothing', () => {
      const [, blobs] = buildPruneLlmCallsStatements({ days: 30 }).statements;
      expect(blobs!.sql).toMatch(/^SELECT count\(\*\) FROM prompt_blobs/i);
      expect(blobs!.sql).not.toMatch(/UPDATE|DELETE/i);
      expect(blobs!.sql).toContain('request IS NOT NULL');
    });

    it('apply: nulls content only, never deletes the blob row', () => {
      const [, blobs] = buildPruneLlmCallsStatements({ days: 30, apply: true }).statements;
      expect(blobs!.sql).toMatch(/^UPDATE prompt_blobs SET content = NULL/i);
      expect(blobs!.sql).not.toMatch(/DELETE/i);
      expect(blobs!.sql).not.toMatch(/hash\s*=|created_at\s*=/i);
    });

    it('is independent of `days` — it runs on whatever llm_calls looks like after statement 1, not its own cutoff', () => {
      const a = buildPruneLlmCallsStatements({ days: 7, apply: true }).statements[1]!;
      const b = buildPruneLlmCallsStatements({ days: 90, apply: true }).statements[1]!;
      expect(a.sql).toBe(b.sql);
      expect(a.params).toEqual([]);
    });
  });

  it('rejects a negative window', () => {
    expect(() => buildPruneLlmCallsStatements({ days: -1 })).toThrow(/non-negative/);
  });
});
