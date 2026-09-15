import { AIMessage } from '@langchain/core/messages';

import * as modelFactory from '@infra/ai/model.factory';

import type { EvalCase } from '../../schema/case.schema';
import { runCase } from '../run-case';

jest.mock('@infra/ai/model.factory', () => {
  const { AIMessage: MockAIMessage } = jest.requireActual('@langchain/core/messages');
  // Scripted replies for tests that need tool-call rounds; falls back to plain text.
  const queue: unknown[] = [];
  const fallback = new MockAIMessage('Мок-ответ тренера');
  const invoke = jest.fn().mockImplementation(async () => (queue.length ? queue.shift() : fallback));
  const model = { invoke, bindTools: () => ({ invoke }) };
  return { getModel: () => model, __mockQueue: queue, __mockInvoke: invoke };
});

const testCase: EvalCase = {
  id: 'CH-TEST',
  phase: 'chat',
  tags: [],
  deprecated: false,
  // registrationCompleted: true — otherwise the router sends the case to the
  // registration phase, whose toolset has no request_transition.
  fixture: {
    user: { languageCode: 'ru', timezone: 'Europe/Berlin', registrationCompleted: true },
    hasActivePlan: true,
  },
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

  it('passes seeded episode turns to the model before the current user message', async () => {
    const { __mockInvoke: invoke } = modelFactory as unknown as { __mockInvoke: jest.Mock };
    const seededCase: EvalCase = {
      ...testCase,
      id: 'CH-SEED',
      state: {
        phase: 'chat',
        activeSessionId: null,
        messages: [
          { role: 'human', text: 'сделал 80 на 8' },
          { role: 'ai', text: 'Принято!' },
        ],
      },
    };

    invoke.mockClear();
    const observation = await runCase(seededCase);

    expect(observation.threw).toBeNull();
    expect(invoke).toHaveBeenCalled();
    // First model call = the agent node's llmMessages: [System, ...seeded history, HumanMessage(userMessage)]
    const llmMessages = invoke.mock.calls[0][0] as Array<{ content: unknown }>;
    const texts = llmMessages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
    const seeded = texts.findIndex(t => t.includes('сделал 80 на 8'));
    const accepted = texts.findIndex(t => t.includes('Принято!'));
    const current = texts.findIndex(t => t.includes('привет'));
    expect(seeded).toBeGreaterThanOrEqual(0);
    expect(accepted).toBeGreaterThan(seeded);
    expect(current).toBeGreaterThan(accepted);
  });

  it('reports a non-null transition from the recorded run row when the model calls request_transition', async () => {
    // The transition must come from recordedRuns[0].transition, not from the final
    // graph state: transition_guard nulls requestedTransition before END
    // (conversation.graph.ts), so result.requestedTransition is always null here.
    const queue = (modelFactory as unknown as { __mockQueue: unknown[] }).__mockQueue;
    queue.push(
      new AIMessage({
        content: '',
        tool_calls: [{ name: 'request_transition', args: { toPhase: 'session_planning' }, id: 'call_1' }],
      }),
      new AIMessage('Идём планировать тренировку'),
    );

    try {
      const observation = await runCase(testCase);
      expect(observation.transition).toBe('session_planning');
      expect(observation.toolCalls.some(tc => tc.name === 'request_transition')).toBe(true);
      expect(observation.threw).toBeNull();
    } finally {
      queue.length = 0;
    }
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
