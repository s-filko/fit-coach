import { guardDecision, planCallCount, selectDatasetFiles } from '../run-guard';

describe('red-button call guard (D-P, PROMPT_EVAL_FRAMEWORK §7a)', () => {
  it('plans cases × samples', () => {
    expect(planCallCount(5, 1)).toBe(5);
    expect(planCallCount(11, 3)).toBe(33);
  });

  it('runs when the planned calls are under the ceiling', () => {
    expect(guardDecision(5, { ceiling: 30, fullRun: false })).toMatchObject({ ok: true });
  });

  it('refuses with the count when over the ceiling without EVALS_FULL_RUN', () => {
    const decision = guardDecision(33, { ceiling: 30, fullRun: false });
    expect(decision.ok).toBe(false);
    expect(decision.plannedCalls).toBe(33);
    expect(decision.message).toContain('EVALS_FULL_RUN=1');
  });

  it('runs over the ceiling when EVALS_FULL_RUN is set', () => {
    const decision = guardDecision(186, { ceiling: 30, fullRun: true });
    expect(decision.ok).toBe(true);
    expect(decision.plannedCalls).toBe(186);
  });

  it('selectDatasetFiles narrows to the requested stem', () => {
    const files = ['basics.jsonl', 'id-reuse.jsonl', 'README.md', 'notes.txt'];
    expect(selectDatasetFiles(files, 'id-reuse')).toEqual(['id-reuse.jsonl']);
  });

  it('selectDatasetFiles keeps every jsonl file when no stem is given', () => {
    const files = ['basics.jsonl', 'id-reuse.jsonl', 'README.md'];
    expect(selectDatasetFiles(files)).toEqual(['basics.jsonl', 'id-reuse.jsonl']);
  });
});
