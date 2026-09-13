import { runCase } from '../run-case';
import type { EvalCase } from '../../schema/case.schema';

jest.mock('@infra/ai/model.factory', () => {
  const { AIMessage } = jest.requireActual('@langchain/core/messages');
  const invoke = jest.fn().mockResolvedValue(new AIMessage('Мок-ответ тренера'));
  return { getModel: () => ({ invoke, bindTools: () => ({ invoke }) }) };
});

const testCase: EvalCase = {
  id: 'CH-TEST',
  phase: 'chat',
  tags: [],
  deprecated: false,
  fixture: { user: { languageCode: 'ru', timezone: 'Europe/Berlin' }, hasActivePlan: true },
  input: { text: 'привет' },
  expect: {},
};

describe('runCase', () => {
  it('returns the final assistant text', async () => {
    const observation = await runCase(testCase);
    expect(observation.text).toContain('Мок-ответ');
    expect(observation.threw).toBeNull();
  });

  it('reports an empty tool-call list when the model called none', async () => {
    const observation = await runCase(testCase);
    expect(observation.toolCalls).toEqual([]);
    expect(observation.transition).toBeNull();
  });
});

describe('ToolRecorder — the tool name comes from runName, not from serialized', () => {
  it('records the tool name and parsed args', async () => {
    const { tool } = await import('@langchain/core/tools');
    const { z } = await import('zod');
    const { ToolRecorder } = await import('../run-case');

    const recorder = new ToolRecorder();
    const t = tool(async () => 'ok', {
      name: 'request_transition',
      description: 'test',
      schema: z.object({ toPhase: z.string() }),
    });

    await t.invoke({ toPhase: 'session_planning' }, { callbacks: [recorder] });

    expect(recorder.calls).toEqual([{ name: 'request_transition', args: { toPhase: 'session_planning' } }]);
  });
});
