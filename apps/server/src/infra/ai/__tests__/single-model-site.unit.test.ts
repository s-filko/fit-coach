import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('ChatOpenAI construction sites (AC-1313)', () => {
  it('exist exactly once, in model.factory.ts', () => {
    const srcDir = path.resolve(__dirname, '../../..');
    const out = execFileSync('grep', ['-rln', 'new ChatOpenAI(', srcDir, '--include=*.ts', '--exclude-dir=__tests__'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(f => path.relative(srcDir, f));
    expect(out).toEqual(['infra/ai/model.factory.ts']);
  });
});
