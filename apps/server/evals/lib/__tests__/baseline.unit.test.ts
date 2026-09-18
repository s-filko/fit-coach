import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compareToBaseline, writeBaseline } from '../baseline';

const results = [
  { case: 'CH-0001', check: 'tools.must:request_transition', passed: true },
  { case: 'CH-0004', check: 'tools.mustNot:request_transition', passed: false },
];

describe('baselines', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'evals-'));
    process.env['EVAL_BASELINE_DIR'] = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env['EVAL_BASELINE_DIR'];
  });

  it('writes a baseline recording the model and every check', () => {
    const path = writeBaseline('v0', 'chat', 'z-ai/glm-5.3', 3, results);
    expect(path).toContain('v0');
    const diff = compareToBaseline('v0', 'chat', results);
    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
  });

  it('reports a check that used to pass and now fails as a regression', () => {
    writeBaseline('v0', 'chat', 'z-ai/glm-5.3', 3, results);
    const worse = [{ ...results[0]!, passed: false }, results[1]!];
    expect(compareToBaseline('v0', 'chat', worse).regressions).toHaveLength(1);
  });

  it('reports a check that used to fail and now passes as an improvement', () => {
    writeBaseline('v0', 'chat', 'z-ai/glm-5.3', 3, results);
    const better = [results[0]!, { ...results[1]!, passed: true }];
    expect(compareToBaseline('v0', 'chat', better).improvements).toHaveLength(1);
  });

  it('lists checks present in the baseline but absent from the run', () => {
    writeBaseline('v0', 'chat', 'z-ai/glm-5.3', 3, results);
    expect(compareToBaseline('v0', 'chat', [results[0]!]).missing).toHaveLength(1);
  });

  it('tags a dataset-scoped baseline and compares against the same scope (D-P)', () => {
    writeBaseline('v2', 'plan_creation', 'z-ai/glm-5.3', 1, results, 'id-reuse');
    const diff = compareToBaseline('v2', 'plan_creation', results, 'id-reuse');
    expect(diff.regressions).toEqual([]);
  });

  it('refuses to compare a dataset-scoped baseline against a full run and vice versa (D-P)', () => {
    writeBaseline('v2', 'plan_creation', 'z-ai/glm-5.3', 1, results, 'id-reuse');
    expect(() => compareToBaseline('v2', 'plan_creation', results)).toThrow(/scope mismatch/);
    writeBaseline('v2', 'chat', 'z-ai/glm-5.3', 3, results);
    expect(() => compareToBaseline('v2', 'chat', results, 'id-reuse')).toThrow(/scope mismatch/);
  });
});
