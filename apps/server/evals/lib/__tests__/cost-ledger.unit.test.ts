import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendLedgerRow,
  completeLastRow,
  estimateRun,
  parseLedgerTable,
  pctOfWeekly,
  summarizeCost,
  type CostRecord,
  CostRecorder,
} from '../cost-ledger';

describe('CostRecorder (D-Q — every model-backed run is metered)', () => {
  it('counts requests and sums tokens across two LLM ends', () => {
    const recorder = new CostRecorder();
    recorder.handleChatModelStart({}, [], 'run-1');
    recorder.handleLLMEnd({ llmOutput: { tokenUsage: { promptTokens: 100, completionTokens: 20 } } }, 'run-1');
    recorder.handleChatModelStart({}, [], 'run-2');
    recorder.handleLLMEnd({ llmOutput: { tokenUsage: { promptTokens: 50, completionTokens: 10 } } }, 'run-2');
    expect(recorder.record()).toEqual({ requests: 2, tokensIn: 150, tokensOut: 30 });
  });

  it('ignores LLM ends for calls it did not start', () => {
    const recorder = new CostRecorder();
    recorder.handleLLMEnd({ llmOutput: { tokenUsage: { promptTokens: 100, completionTokens: 20 } } }, 'other-run');
    expect(recorder.record()).toEqual({ requests: 0, tokensIn: 0, tokensOut: 0 });
  });

  it('reads openai-style usage as a fallback', () => {
    const recorder = new CostRecorder();
    recorder.handleChatModelStart({}, [], 'run-1');
    recorder.handleLLMEnd({ llmOutput: { usage: { prompt_tokens: 7, completion_tokens: 3 } } }, 'run-1');
    expect(recorder.record()).toEqual({ requests: 1, tokensIn: 7, tokensOut: 3 });
  });
});

describe('summarizeCost', () => {
  it('sums records and returns zeros for an empty list', () => {
    const records: CostRecord[] = [
      { requests: 2, tokensIn: 100, tokensOut: 20 },
      { requests: 1, tokensIn: 50, tokensOut: 10 },
    ];
    expect(summarizeCost(records)).toEqual({ requests: 3, tokensIn: 150, tokensOut: 30 });
    expect(summarizeCost([])).toEqual({ requests: 0, tokensIn: 0, tokensOut: 0 });
  });
});

describe('estimateRun (D-Q — the owner needs the number before pressing the button)', () => {
  it('estimates from the ledger running average', () => {
    const ledger: CostRecord[] = [{ requests: 10, tokensIn: 2000, tokensOut: 500 }];
    const estimate = estimateRun(5, ledger);
    expect(estimate.avgTokensPerRequest).toBe(250);
    expect(estimate.estimatedTokens).toBe(1250);
    expect(estimate.note).toBeUndefined();
  });

  it('returns "no history" on an empty ledger', () => {
    const estimate = estimateRun(5, []);
    expect(estimate.avgTokensPerRequest).toBeNull();
    expect(estimate.estimatedTokens).toBe(0);
    expect(estimate.note).toContain('no history');
  });
});

describe('ledger table round-trip (D-Q)', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cost-ledger-'));
    path = join(dir, 'COST_LEDGER.md');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses what appendLedgerRow writes', () => {
    appendLedgerRow(path, {
      date: '2026-09-18',
      command: 'npm run evals -- --level L1 --phase chat',
      scope: 'L1 chat (11 cases × 1)',
      requests: 11,
      tokensIn: 12000,
      tokensOut: 3000,
      quotaBefore: '45000',
      quotaAfter: '?',
      delta: '?',
      pctWeekly: '?',
    });
    const parsed = parseLedgerTable(readFileSync(path, 'utf8'));
    expect(parsed).toEqual([{ requests: 11, tokensIn: 12000, tokensOut: 3000 }]);
  });

  it('completeLastRow fills quota after, delta and % of weekly', () => {
    appendLedgerRow(path, {
      date: '2026-09-18',
      command: 'npm run evals',
      scope: 'L1 chat (11×1)',
      requests: 11,
      tokensIn: 12000,
      tokensOut: 3000,
      quotaBefore: '45000',
      quotaAfter: '?',
      delta: '?',
      pctWeekly: '?',
    });
    completeLastRow(path, { quotaAfter: 44700, weeklyLimit: 30000 });
    const row = readFileSync(path, 'utf8')
      .split('\n')
      .filter(l => l.startsWith('| 2026'))
      .pop();
    expect(row).toContain('| 44700 | -300 |');
    expect(row).toMatch(/1\.0%|1%/);
  });

  it('parses an empty ledger (header only) without rows', () => {
    writeFileSync(path, '# ledger\n\n| date | command |\n|---|---|\n', 'utf8');
    expect(parseLedgerTable(readFileSync(path, 'utf8'))).toEqual([]);
  });
});

describe('pctOfWeekly', () => {
  it('is delta / weekly limit as a percentage', () => {
    expect(pctOfWeekly(-300, 30000)).toBeCloseTo(-1);
    expect(pctOfWeekly(300, 30000)).toBeCloseTo(1);
  });

  it('is null without a weekly limit', () => {
    expect(pctOfWeekly(-300, undefined)).toBeNull();
  });
});
