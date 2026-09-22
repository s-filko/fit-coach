import { buildPruneLlmCallsStatement } from '../prune-llm-calls';

describe('buildPruneLlmCallsStatement (AC-AT-6)', () => {
  it('dry run: counts rows past the cutoff with a payload, changes nothing', () => {
    const { sql, params } = buildPruneLlmCallsStatement({ days: 30 });
    expect(sql).toMatch(/^SELECT count\(\*\)/i);
    expect(sql).not.toMatch(/UPDATE|DELETE/i);
    expect(sql).toContain('created_at < now() - make_interval(days => $1::int)');
    expect(params).toEqual([30]);
  });

  it('apply: nulls request and response only, never deletes the row', () => {
    const { sql, params } = buildPruneLlmCallsStatement({ days: 7, apply: true });
    expect(sql).toMatch(/^UPDATE llm_calls SET request = NULL, response = NULL/i);
    expect(sql).not.toMatch(/DELETE/i);
    // Metadata columns never appear on the left of an assignment.
    expect(sql).not.toMatch(/run_id\s*=|call_index\s*=|model\s*=|latency_ms\s*=|error_class\s*=|error_message\s*=/i);
    expect(params).toEqual([7]);
  });

  it('skips rows whose payload is already null, so a second run is a no-op', () => {
    const { sql } = buildPruneLlmCallsStatement({ days: 30, apply: true });
    expect(sql).toContain('(request IS NOT NULL OR response IS NOT NULL)');
  });

  it('rejects a negative window', () => {
    expect(() => buildPruneLlmCallsStatement({ days: -1 })).toThrow(/non-negative/);
  });
});
