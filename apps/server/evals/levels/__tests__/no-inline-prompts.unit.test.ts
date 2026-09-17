import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('no inline prompt text outside src/infra/ai/prompts (ADR-0013 §5, BR-LLM-009)', () => {
  // Same coverage as the eslint.config.js no-restricted-syntax override:
  // graph/, context/, messages/ and tools/ (the latter two since P3).
  const scanDirs = [
    path.resolve(__dirname, '../../../src/infra/ai/graph'),
    path.resolve(__dirname, '../../../src/infra/ai/context'),
    path.resolve(__dirname, '../../../src/infra/ai/messages'),
    path.resolve(__dirname, '../../../src/infra/ai/tools'),
  ];

  function grep(pattern: string): string[] {
    try {
      return execFileSync('grep', ['-rnE', pattern, ...scanDirs, '--include=*.ts', '--exclude-dir=__tests__'], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
    } catch (err) {
      if ((err as { status?: number }).status === 1) return []; // grep: no matches
      throw err;
    }
  }

  it('has no SystemMessage built from a literal', () => {
    expect(grep(`new SystemMessage\\(\\s*['"\`]`)).toEqual([]);
  });

  it('has no === HEADER === prompt text', () => {
    expect(grep(`['"\`]=== [A-Z ]+`)).toEqual([]);
  });

  it('has no role: system message with literal content', () => {
    expect(grep(`role: 'system', content: ['"\`]`)).toEqual([]);
  });
});
