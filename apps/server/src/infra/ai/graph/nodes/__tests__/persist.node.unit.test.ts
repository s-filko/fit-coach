import type { ConversationStateType } from '@domain/conversation/graph/conversation.state';

import { buildPersistNode } from '@infra/ai/graph/nodes/persist.node';

const baseState = (overrides: Partial<ConversationStateType> = {}): ConversationStateType =>
  ({
    userId: 'user-1',
    runId: 'run-1',
    phase: 'chat',
    userMessage: 'hello',
    responseMessage: 'hi there',
    user: null,
    activeSessionId: null,
    requestedTransition: null,
    ...overrides,
  }) as ConversationStateType;

describe('persist node run logging (AC-1301)', () => {
  const contextService = { appendTurn: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => jest.clearAllMocks());

  it('records exactly one run row per invocation', async () => {
    const runService = { recordRun: jest.fn().mockResolvedValue(undefined) };
    const node = buildPersistNode(contextService as never, runService as never);

    await node(baseState());

    expect(runService.recordRun).toHaveBeenCalledTimes(1);
    const [[record]] = runService.recordRun.mock.calls;
    expect(record.runId).toBe('run-1');
    expect(record.userId).toBe('user-1');
    expect(record.phaseIn).toBe('chat');
    expect(record.outcome).toBe('ok');
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    expect(record.promptVersions).toEqual({ 'phase.chat': 'v0', directives: 'v0' });
  });

  it('records the requested transition as phase_out', async () => {
    const runService = { recordRun: jest.fn().mockResolvedValue(undefined) };
    const node = buildPersistNode(contextService as never, runService as never);

    await node(baseState({ requestedTransition: { toPhase: 'session_planning' } }));

    const [[record]] = runService.recordRun.mock.calls;
    expect(record.phaseOut).toBe('session_planning');
    expect(record.transition).toEqual({ toPhase: 'session_planning' });
  });

  it('still returns normally when the run write throws', async () => {
    const runService = { recordRun: jest.fn().mockRejectedValue(new Error('db down')) };
    const node = buildPersistNode(contextService as never, runService as never);

    await expect(node(baseState())).resolves.toEqual({});
    expect(contextService.appendTurn).toHaveBeenCalled();
  });

  it('writes no run row when there is no response to persist', async () => {
    const runService = { recordRun: jest.fn().mockResolvedValue(undefined) };
    const node = buildPersistNode(contextService as never, runService as never);

    await node(baseState({ responseMessage: '' }));

    expect(runService.recordRun).not.toHaveBeenCalled();
  });
});
