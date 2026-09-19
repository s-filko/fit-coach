import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * AC-1311 — the legacy LLM path vocabulary is gone from src/:
 * `jsonMode` / `json_object` (the LLMService JSON-mode API) and `LLMService` itself.
 * The search literals are concatenated so this file's own source does not
 * self-match; __tests__ is excluded as a second guard (tests may discuss the
 * retired names, production code may not contain them).
 *
 * `json_object` re-enters src only as the provider wire value of
 * LLM_STRUCTURED_OUTPUT_MODE behind the single gateway (plan
 * structured-output-json-object-mode, 2026-09-19 — Z.AI supports only
 * text/json_object); the retired LLMService JSON-mode API remains banned.
 */
const JSON_OBJECT_ALLOWLIST = ['config/index.ts', 'infra/ai/llm.gateway.ts', 'infra/ai/structured-json.ts'];

/** grep -rl over src (outside __tests__) for `vocabulary`, as repo-relative paths. */
function offenders(vocabulary: string): string[] {
  const srcDir = path.resolve(__dirname, '../../..');
  let raw = '';
  try {
    raw = execFileSync('grep', ['-rl', vocabulary, srcDir, '--include=*.ts', '--exclude-dir=__tests__'], {
      encoding: 'utf8',
    });
  } catch (err) {
    // grep exits 1 when there are no matches — that is exactly the assertion target
    if ((err as { status?: number }).status !== 1) {
      throw err;
    }
  }
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(f => path.relative(srcDir, f));
}

/** The offenders a vocabulary ban still rejects, after the json_object allowlist. */
function unexpected(offenderList: string[], allowlist: string[]): string[] {
  return offenderList.filter(f => !allowlist.includes(f));
}

describe('Legacy LLM path vocabulary (AC-1311)', () => {
  it('has no occurrences in src outside tests', () => {
    expect(offenders(['jsonMode', '\\|LLM', 'Service'].join(''))).toEqual([]);
    expect(unexpected(offenders('json_object'), JSON_OBJECT_ALLOWLIST)).toEqual([]);
  });

  it('a json_object occurrence in any other src file still fails the guard', () => {
    expect(unexpected(['infra/ai/llm.gateway.ts', 'app/routes/chat.ts'], JSON_OBJECT_ALLOWLIST)).toEqual([
      'app/routes/chat.ts',
    ]);
  });
});
