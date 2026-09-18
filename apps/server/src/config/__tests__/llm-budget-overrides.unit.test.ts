import { parseLlmBudgetOverrides } from '../llm-budget-overrides';

describe('parseLlmBudgetOverrides (P4 context-budget plan Task 3 — LLM_BUDGET_<PHASE>_<PART> overrides, D-L exception)', () => {
  it('returns an empty map when no LLM_BUDGET_* variable is set', () => {
    expect(parseLlmBudgetOverrides({ LLM_MODEL: 'x', OTHER: 'y' })).toEqual({});
  });

  it('collects a partial override per lower-cased phase name', () => {
    const overrides = parseLlmBudgetOverrides({
      LLM_BUDGET_CHAT_SYSTEM: '3500',
      LLM_BUDGET_CHAT_HISTORY: '9000',
      LLM_BUDGET_TRAINING_DOMAIN: '7000',
    });
    expect(overrides).toEqual({
      chat: { system: 3500, history: 9000 },
      training: { domain: 7000 },
    });
  });

  it('covers every TokenBudget part', () => {
    const overrides = parseLlmBudgetOverrides({
      LLM_BUDGET_SESSION_PLANNING_SYSTEM: '1',
      LLM_BUDGET_SESSION_PLANNING_LONG_TERM: '2',
      LLM_BUDGET_SESSION_PLANNING_DOMAIN: '3',
      LLM_BUDGET_SESSION_PLANNING_HISTORY: '4',
      LLM_BUDGET_SESSION_PLANNING_OUTPUT_RESERVE: '5',
    });
    expect(overrides.session_planning).toEqual({
      system: 1,
      longTerm: 2,
      domain: 3,
      history: 4,
      outputReserve: 5,
    });
  });

  it('ignores empty values', () => {
    expect(parseLlmBudgetOverrides({ LLM_BUDGET_CHAT_SYSTEM: '   ' })).toEqual({});
  });

  it('rejects a non-integer or non-positive value', () => {
    expect(() => parseLlmBudgetOverrides({ LLM_BUDGET_CHAT_SYSTEM: 'lots' })).toThrow(/LLM_BUDGET_CHAT_SYSTEM/);
    expect(() => parseLlmBudgetOverrides({ LLM_BUDGET_CHAT_SYSTEM: '0' })).toThrow(/LLM_BUDGET_CHAT_SYSTEM/);
    expect(() => parseLlmBudgetOverrides({ LLM_BUDGET_CHAT_SYSTEM: '1.5' })).toThrow(/LLM_BUDGET_CHAT_SYSTEM/);
  });
});
