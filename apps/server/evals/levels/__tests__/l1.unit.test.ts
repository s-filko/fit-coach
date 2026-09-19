import type { BudgetReport } from '@domain/conversation/ports';

import type { CaseObservation } from '../../lib/run-case';
import type { EvalCase } from '../../schema/case.schema';
import { assertCase, loadCases } from '../l1';

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
  longTerm: 0,
  summary: 0,
  domain: 0,
  blocks: [],
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
  lastModelInput: [],
  assembledInput: 'Assembled prompt without facts',
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

describe('no_redundant_search (AC-1344, D-N)', () => {
  const seededSearchCase: EvalCase = {
    ...base,
    id: 'PCR-0001',
    phase: 'plan_creation',
    state: {
      phase: 'plan_creation',
      messages: [
        { role: 'human', text: 'составь план' },
        { role: 'tool_call', name: 'search_exercises', args: { query: 'Upper Body Compound' } },
        { role: 'tool_result', text: 'Found 3 exercises:' },
        { role: 'ai', text: 'Предлагаю…' },
      ],
    },
  };
  const search = (query: string) => ({ name: 'search_exercises', args: { query } });

  it('AC-1344: no_redundant_search fails on a repeated seeded key', () => {
    const results = assertCase(seededSearchCase, observed({ toolCalls: [search('upper body compound')] }));
    expect(results.find(r => r.check === 'no_redundant_search')?.passed).toBe(false);
  });

  it('AC-1344: no_redundant_search fails when the run repeats its own earlier search key', () => {
    const results = assertCase(
      seededSearchCase,
      observed({ toolCalls: [search('legs bodyweight'), search('legs bodyweight')] }),
    );
    expect(results.find(r => r.check === 'no_redundant_search')?.passed).toBe(false);
  });

  it('AC-1344: no_redundant_search passes when the run reuses ids without searching', () => {
    const results = assertCase(seededSearchCase, observed({ toolCalls: [] }));
    expect(results.find(r => r.check === 'no_redundant_search')?.passed).toBe(true);
  });

  it('AC-1344: no_redundant_search passes for a different search key (new intent, not redundant)', () => {
    const results = assertCase(seededSearchCase, observed({ toolCalls: [search('legs bodyweight')] }));
    expect(results.find(r => r.check === 'no_redundant_search')?.passed).toBe(true);
  });

  it('AC-1344: no_redundant_search is not emitted for cases without seeded searches', () => {
    const noSeeds: EvalCase = {
      ...base,
      state: {
        phase: 'chat',
        messages: [
          { role: 'human', text: 'q' },
          { role: 'ai', text: 'a' },
        ],
      },
    };
    const results = assertCase(noSeeds, observed({ toolCalls: [search('upper body compound')] }));
    expect(results.some(r => r.check === 'no_redundant_search')).toBe(false);
  });

  // D-C / AC-1343 (P4 context-budget plan Task 4): the two INV-LLM-004 L1 checks.
  describe('budget-within-limits', () => {
    it('passes when history is within budget.history', () => {
      const results = assertCase(
        base,
        observed({
          budgetReport: {
            ...budgetReport,
            history: 100,
            budget: { system: 500, longTerm: 100, domain: 100, history: 8000, outputReserve: 100 },
          },
        }),
      );
      expect(results.find(r => r.check === 'budget-within-limits')?.passed).toBe(true);
    });

    it('fails when history exceeds budget.history', () => {
      const overBudget = { system: 1, longTerm: 1, domain: 1, history: 8000, outputReserve: 1 };
      const results = assertCase(
        base,
        observed({ budgetReport: { ...budgetReport, history: 9000, budget: overBudget } }),
      );
      const check = results.find(r => r.check === 'budget-within-limits');
      expect(check?.passed).toBe(false);
      expect(check?.detail).toContain('9000');
    });

    it('fails when total exceeds sum - outputReserve', () => {
      const budget = { system: 100, longTerm: 100, domain: 100, history: 100, outputReserve: 50 };
      const results = assertCase(
        base,
        observed({ budgetReport: { ...budgetReport, history: 50, total: 10000, budget } }),
      );
      expect(results.find(r => r.check === 'budget-within-limits')?.passed).toBe(false);
    });

    it('is not emitted when no budgetReport was attached (no model call)', () => {
      const results = assertCase(base, observed({ budgetReport: null }));
      expect(results.some(r => r.check === 'budget-within-limits')).toBe(false);
    });

    it('is not emitted when the report carries no budget (pre-Task-3 shape)', () => {
      const { budget: _b, ...noBudget } = budgetReport;
      const results = assertCase(base, observed({ budgetReport: noBudget }));
      expect(results.some(r => r.check === 'budget-within-limits')).toBe(false);
    });
  });

  describe('no-orphan-tool-message', () => {
    it('passes when every ToolMessage answers a tool_call_id present in an AIMessage', () => {
      const results = assertCase(
        base,
        observed({
          lastModelInput: [
            { type: 'system', toolCallIds: [] },
            { type: 'ai', toolCallIds: ['tc1'] },
            { type: 'tool', toolCallIds: [], toolCallId: 'tc1' },
          ],
        }),
      );
      expect(results.find(r => r.check === 'no-orphan-tool-message')?.passed).toBe(true);
    });

    it('fails when a ToolMessage answers a tool_call_id no AIMessage carries', () => {
      const results = assertCase(
        base,
        observed({
          lastModelInput: [
            { type: 'system', toolCallIds: [] },
            { type: 'tool', toolCallIds: [], toolCallId: 'orphan' },
          ],
        }),
      );
      const check = results.find(r => r.check === 'no-orphan-tool-message');
      expect(check?.passed).toBe(false);
      expect(check?.detail).toContain('orphan');
    });

    it('passes trivially when there are no ToolMessages', () => {
      const results = assertCase(base, observed({ lastModelInput: [{ type: 'system', toolCallIds: [] }] }));
      expect(results.find(r => r.check === 'no-orphan-tool-message')?.passed).toBe(true);
    });

    it('is not emitted when lastModelInput is empty (no model call observed)', () => {
      const results = assertCase(base, observed({ lastModelInput: [] }));
      expect(results.some(r => r.check === 'no-orphan-tool-message')).toBe(false);
    });
  });

  describe('user-facts-block-present (AC-1361, P6 Task 6)', () => {
    const factsCase: EvalCase = {
      ...base,
      id: 'MF-TEST',
      phase: 'session_planning',
      fixture: {
        ...base.fixture,
        hasActivePlan: true,
        facts: [
          { category: 'physical_constraint', fact: 'Травмировано правое плечо', muscleGroup: 'shoulders_front' },
          { category: 'exercise_preference', fact: 'Предпочитает гантели штангам', muscleGroup: null },
        ],
      },
    };
    const assembledWithFacts =
      '## User Facts\nphysical_constraint:\n- Травмировано правое плечо (shoulders_front)\nexercise_preference:\n- Предпочитает гантели штангам';

    it('passes when the assembled input carries the heading and every fact text', () => {
      const results = assertCase(factsCase, observed({ assembledInput: assembledWithFacts }));
      expect(results.find(r => r.check === 'user-facts-block-present')?.passed).toBe(true);
    });

    it('fails when the ## User Facts heading is missing', () => {
      const results = assertCase(factsCase, observed({ assembledInput: 'Травмировано правое плечо, но без блока' }));
      const check = results.find(r => r.check === 'user-facts-block-present');
      expect(check?.passed).toBe(false);
      expect(check?.detail).toContain('## User Facts');
    });

    it('fails when the heading is present but a fact text is missing', () => {
      const results = assertCase(
        factsCase,
        observed({
          assembledInput: '## User Facts\nphysical_constraint:\n- Травмировано правое плечо (shoulders_front)',
        }),
      );
      const check = results.find(r => r.check === 'user-facts-block-present');
      expect(check?.passed).toBe(false);
      expect(check?.detail).toContain('Предпочитает гантели');
    });

    it('is not emitted for facts-free fixtures (baselines v0–v2 record nothing new)', () => {
      const results = assertCase(base, observed());
      expect(results.some(r => r.check === 'user-facts-block-present')).toBe(false);
    });
  });

  describe('loadCases (cross-phase directory, P6 Task 6)', () => {
    it('loads memory/facts — the first cross-phase dataset — via its directory key', () => {
      const cases = loadCases('memory', 'facts');
      expect(cases.length).toBeGreaterThanOrEqual(4);
      expect(cases.every(c => c.id.startsWith('MF-'))).toBe(true);
      // Routing comes from the case's own phase field, never from the directory.
      expect(cases.every(c => c.phase === 'session_planning')).toBe(true);
      expect(cases.every(c => (c.fixture.facts ?? []).length > 0)).toBe(true);
    });

    it('loads existing phase datasets exactly as before', () => {
      expect(loadCases('chat').length).toBeGreaterThan(0);
      const chatIds = loadCases('chat').map(c => c.id);
      expect(chatIds).toContain('CH-0001');
      // The memory dataset never leaks into a phase directory's load.
      expect(chatIds.some(id => id.startsWith('MF-'))).toBe(false);
    });
  });
});
