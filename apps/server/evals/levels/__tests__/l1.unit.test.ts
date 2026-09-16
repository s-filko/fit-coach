import type { BudgetReport } from '@domain/conversation/ports';

import type { CaseObservation } from '../../lib/run-case';
import type { EvalCase } from '../../schema/case.schema';
import { assertCase } from '../l1';

const base: EvalCase = {
  id: 'CH-0001',
  phase: 'chat',
  tags: [],
  deprecated: false,
  fixture: { user: { languageCode: 'ru', timezone: 'Europe/Berlin' } },
  input: { text: 'давай потренируемся' },
  expect: {},
};

const budgetReport: BudgetReport = {
  estimator: 'chars/4',
  system: 500,
  summary: 0,
  history: 100,
  user: 20,
  inFlight: 0,
  toolResults: 0,
  total: 620,
  messages: 3,
  historyTurns: 1,
};

const observed = (overrides: Partial<CaseObservation> = {}): CaseObservation => ({
  text: 'Идём в планирование тренировки',
  toolCalls: [{ name: 'request_transition', args: { toPhase: 'session_planning' } }],
  transition: 'session_planning',
  outcome: 'ok',
  threw: null,
  budgetReport: null,
  ...overrides,
});

describe('assertCase', () => {
  it('passes when a required tool was called', () => {
    const results = assertCase({ ...base, expect: { tools: { must: ['request_transition'] } } }, observed());
    expect(results.find(r => r.check === 'tools.must:request_transition')?.passed).toBe(true);
  });

  it('fails when a required tool was not called', () => {
    const results = assertCase(
      { ...base, expect: { tools: { must: ['request_transition'] } } },
      observed({ toolCalls: [] }),
    );
    expect(results.find(r => r.check === 'tools.must:request_transition')?.passed).toBe(false);
  });

  it('fails when a forbidden tool was called', () => {
    const results = assertCase(
      { ...base, expect: { tools: { mustNot: ['log_set'] } } },
      observed({ toolCalls: [{ name: 'log_set', args: {} }] }),
    );
    expect(results.find(r => r.check === 'tools.mustNot:log_set')?.passed).toBe(false);
  });

  it('fails on forbidden text — the false-confirmation gate', () => {
    const results = assertCase(
      { ...base, expect: { text: { mustNotMatch: ['(?i)записал|logged'] } } },
      observed({ text: 'Записал твой подход!' }),
    );
    expect(results.find(r => r.check.startsWith('text.mustNotMatch'))?.passed).toBe(false);
  });

  it('checks the committed transition', () => {
    const results = assertCase({ ...base, expect: { transition: null } }, observed());
    expect(results.find(r => r.check === 'transition')?.passed).toBe(false);
  });

  it('fails everything when the run threw', () => {
    const results = assertCase({ ...base, expect: { tools: { must: ['x'] } } }, observed({ threw: 'boom' }));
    expect(results.some(r => r.check === 'runs-without-throwing' && !r.passed)).toBe(true);
  });

  it('passes budget-report-present when the observation carries a report with a positive total', () => {
    const results = assertCase({ ...base, expect: {} }, observed({ budgetReport }));
    expect(results.find(r => r.check === 'budget-report-present')?.passed).toBe(true);
  });

  it('fails budget-report-present when no report was attached', () => {
    const results = assertCase({ ...base, expect: {} }, observed({ budgetReport: null }));
    expect(results.find(r => r.check === 'budget-report-present')?.passed).toBe(false);
  });

  it('fails budget-report-present when the report total is zero', () => {
    const results = assertCase({ ...base, expect: {} }, observed({ budgetReport: { ...budgetReport, total: 0 } }));
    expect(results.find(r => r.check === 'budget-report-present')?.passed).toBe(false);
  });

  it('does not add budget-report-present when the run threw', () => {
    const results = assertCase(
      { ...base, expect: { tools: { must: ['x'] } } },
      observed({ threw: 'boom', budgetReport: null }),
    );
    expect(results.some(r => r.check === 'budget-report-present')).toBe(false);
  });

  it('flags Latin script when the case expects Russian', () => {
    const results = assertCase(
      { ...base, expect: { text: { language: 'ru' } } },
      observed({ text: 'Let us go to session planning' }),
    );
    expect(results.find(r => r.check === 'text.language')?.passed).toBe(false);
  });

  it('rejects markdown bold — Telegram HTML only', () => {
    const results = assertCase(
      { ...base, expect: { text: { format: 'telegram_html' } } },
      observed({ text: 'Готово **жирным**' }),
    );
    expect(results.find(r => r.check === 'text.format')?.passed).toBe(false);
  });

  it('translates the (?i) prefix into a case-insensitive match', () => {
    const results = assertCase(
      { ...base, expect: { text: { mustMatch: ['(?i)logged'] } } },
      observed({ text: 'Logged your set' }),
    );
    expect(results.find(r => r.check.startsWith('text.mustMatch'))?.passed).toBe(true);
  });
});
