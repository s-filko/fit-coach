import { buildConversationGraph } from '../conversation.graph';

describe('ConversationGraph — skeleton', () => {
  it('returns state unchanged when invoked with dummy state', async() => {
    const graph = buildConversationGraph();

    const input = {
      userId: 'u1',
      phase: 'chat' as const,
      messages: [],
      userMessage: 'hello',
      responseMessage: '',
      requestedTransition: null,
    };

    const result = await graph.invoke(input);

    expect(result.userId).toBe('u1');
    expect(result.phase).toBe('chat');
    expect(result.userMessage).toBe('hello');
    expect(result.responseMessage).toBe('');
    expect(result.requestedTransition).toBeNull();
    expect(result.messages).toEqual([]);
  });

  it('compiles without throwing', () => {
    expect(() => buildConversationGraph()).not.toThrow();
  });
});
