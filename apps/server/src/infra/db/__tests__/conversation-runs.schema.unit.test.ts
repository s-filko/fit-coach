import { conversationRuns, conversationTurns } from '@infra/db/schema';

describe('conversation_runs schema (ADR-0013 §8)', () => {
  it('exposes every column the run log needs', () => {
    const columns = Object.keys(conversationRuns);
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'runId',
        'userId',
        'phaseIn',
        'phaseOut',
        'trigger',
        'client',
        'model',
        'promptVersions',
        'tokensIn',
        'tokensOut',
        'latencyMs',
        'toolCalls',
        'transition',
        'outcome',
        'budgetReport',
        'createdAt',
      ]),
    );
  });

  it('requires the fields AC-1301 asserts are non-null', () => {
    expect(conversationRuns.runId.notNull).toBe(true);
    expect(conversationRuns.phaseIn.notNull).toBe(true);
    expect(conversationRuns.model.notNull).toBe(true);
    expect(conversationRuns.latencyMs.notNull).toBe(true);
    expect(conversationRuns.outcome.notNull).toBe(true);
  });

  it('adds run_id, kind and payload to conversation_turns', () => {
    const columns = Object.keys(conversationTurns);
    expect(columns).toEqual(expect.arrayContaining(['runId', 'kind', 'payload']));
    expect(conversationTurns.kind.notNull).toBe(true);
  });
});
