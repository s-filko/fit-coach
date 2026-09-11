import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

import { invokeWithRetry } from '@infra/ai/graph/invoke-with-retry';

const makeModel = (responses: AIMessage[]) => {
  let callCount = 0;
  return {
    invoke: jest.fn().mockImplementation(async () => {
      const response = responses[callCount] ?? responses[responses.length - 1];
      callCount++;
      return response;
    }),
  };
};

const hasNudgeSystemMessage = (messages: unknown[]): boolean =>
  messages.some(m => m instanceof SystemMessage && (m.content as string).includes('All tool calls are complete'));

describe('invokeWithRetry', () => {
  describe('normal (no ToolMessage at end)', () => {
    it('returns response immediately when content is non-empty', async () => {
      const model = makeModel([new AIMessage('Hello!')]);
      const result = await invokeWithRetry(model as never, [new HumanMessage('hi')], 'user-1');

      expect(result.content).toBe('Hello!');
      expect(model.invoke).toHaveBeenCalledTimes(1);
    });

    it('retries when LLM returns empty string with no tool calls', async () => {
      const model = makeModel([new AIMessage({ content: '' }), new AIMessage('Here is your plan!')]);
      const result = await invokeWithRetry(model as never, [new HumanMessage('hi')], 'user-1');

      expect(result.content).toBe('Here is your plan!');
      expect(model.invoke).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry when response has tool calls even if content is empty', async () => {
      const withTools = new AIMessage({
        content: '',
        tool_calls: [{ name: 'search_exercises', args: { query: 'chest' }, id: 'tc-1', type: 'tool_call' }],
      });
      const model = makeModel([withTools]);
      const result = await invokeWithRetry(model as never, [new HumanMessage('hi')], 'user-1');

      expect(result.tool_calls).toHaveLength(1);
      expect(model.invoke).toHaveBeenCalledTimes(1);
    });

    it('does NOT inject nudge when last message is not ToolMessage', async () => {
      const model = makeModel([new AIMessage('Hi')]);
      const messages = [new HumanMessage('hi')];
      await invokeWithRetry(model as never, messages, 'user-1');

      const firstCallMessages = model.invoke.mock.calls[0][0] as unknown[];
      expect(hasNudgeSystemMessage(firstCallMessages)).toBe(false);
    });
  });

  describe('post-tool turn (last message is ToolMessage)', () => {
    const aiWithTool = new AIMessage({
      content: 'Saving now...',
      tool_calls: [{ name: 'save_workout_plan', args: {}, id: 'tc-1', type: 'tool_call' }],
    });
    const toolResult = new ToolMessage({ tool_call_id: 'tc-1', content: 'Plan saved. Now write confirmation.' });
    const messages = [new HumanMessage('save it'), aiWithTool, toolResult];

    it('injects nudge SystemMessage before ToolMessage on first invoke', async () => {
      const model = makeModel([new AIMessage('Plan saved, congrats!')]);
      await invokeWithRetry(model as never, messages, 'user-1');

      const firstCallMessages = model.invoke.mock.calls[0][0] as unknown[];
      expect(hasNudgeSystemMessage(firstCallMessages)).toBe(true);
      expect(model.invoke).toHaveBeenCalledTimes(1);
    });

    it('nudge is placed before the ToolMessage, not at the end', async () => {
      const model = makeModel([new AIMessage('Done!')]);
      await invokeWithRetry(model as never, messages, 'user-1');

      const sent = model.invoke.mock.calls[0][0] as unknown[];
      const nudgeIdx = sent.findIndex(
        m => m instanceof SystemMessage && (m.content as string).includes('All tool calls'),
      );
      const toolIdx = sent.findIndex(m => m instanceof ToolMessage);
      expect(nudgeIdx).toBeGreaterThanOrEqual(0);
      expect(nudgeIdx).toBeLessThan(toolIdx);
    });

    it('retries with nudge when LLM still returns empty', async () => {
      const model = makeModel([new AIMessage({ content: '' }), new AIMessage('Done!')]);
      const result = await invokeWithRetry(model as never, messages, 'user-1');

      expect(result.content).toBe('Done!');
      expect(model.invoke).toHaveBeenCalledTimes(2);
      // Both calls must have nudge
      for (const call of model.invoke.mock.calls) {
        expect(hasNudgeSystemMessage(call[0] as unknown[])).toBe(true);
      }
    });
  });
});
