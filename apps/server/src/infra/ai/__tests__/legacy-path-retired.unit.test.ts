import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * AC-1311 — the legacy LLM path vocabulary is gone from src/:
 * `jsonMode` / `json_object` (the LLMService JSON-mode API) and `LLMService` itself.
 * The search literals are concatenated so this file's own source does not
 * self-match; __tests__ is excluded as a second guard (tests may discuss the
 * retired names, production code may not contain them).
 */
describe('Legacy LLM path vocabulary (AC-1311)', () => {
  it('has no occurrences in src outside tests', () => {
    const PATTERN = ['jsonMode', '\\|json_', 'object', '\\|LLM', 'Service'].join('');
    const srcDir = path.resolve(__dirname, '../../..');
    let raw = '';
    try {
      raw = execFileSync('grep', ['-rl', PATTERN, srcDir, '--include=*.ts', '--exclude-dir=__tests__'], {
        encoding: 'utf8',
      });
    } catch (err) {
      // grep exits 1 when there are no matches — that is exactly the assertion target
      if ((err as { status?: number }).status !== 1) {
        throw err;
      }
    }
    const out = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(f => path.relative(srcDir, f));
    expect(out).toEqual([]);
  });
});
