/**
 * AC-1346 (refactor-p4-episode-memory Task 7): the legacy rolling-summary
 * memory path is gone from `apps/server/src` — no read side that could feed
 * the prompt from the transcript (INV-LLM-001), no reset marker. A grep test:
 * the pattern is built by concatenation so this file does not match itself.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

// evals/levels/__tests__ → three ups → apps/server/src
const SRC_ROOT = join(dirname(__filename), '..', '..', '..', 'src');

// The three legacy identifiers the plan names (AC-1346).
const PATTERN =
  ['getMessages', 'ForPrompt'].join('') +
  '|' +
  ['getLatest', 'Summary'].join('') +
  '|' +
  ['__', 'context_reset', '__'].join('');

describe('AC-1346: the legacy context memory path is removed', () => {
  it(`grep -rn "${PATTERN}" apps/server/src → empty`, () => {
    let out = '';
    try {
      out = execFileSync('grep', ['-rn', '-E', PATTERN, SRC_ROOT], { encoding: 'utf8' });
    } catch (err) {
      // grep exits 1 on no matches — exactly what AC-1346 requires.
      expect((err as { status?: number }).status).toBe(1);
      return;
    }
    // Any match is a violation; print them for the failure output.
    expect(out).toBe('');
  });
});
