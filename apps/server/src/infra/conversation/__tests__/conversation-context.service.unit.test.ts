import { InMemoryConversationContextService } from '../conversation-context.service';

describe('InMemoryConversationContextService', () => {
  let service: InMemoryConversationContextService;

  beforeEach(() => {
    service = new InMemoryConversationContextService();
  });

  describe('appendTurn + getMessagesForPrompt', () => {
    it('returns empty array before any turns', async () => {
      const messages = await service.getMessagesForPrompt('u1', 'chat');
      expect(messages).toHaveLength(0);
    });

    it('returns user+assistant turns after appendTurn', async () => {
      await service.appendTurn('u1', 'chat', 'hello', 'hi there');

      const messages = await service.getMessagesForPrompt('u1', 'chat');
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'user', content: 'hello' });
      expect(messages[1]).toEqual({ role: 'assistant', content: 'hi there' });
    });

    it('appends multiple turns in chronological order', async () => {
      await service.appendTurn('u1', 'chat', 'first', 'resp-first');
      await service.appendTurn('u1', 'chat', 'second', 'resp-second');

      const messages = await service.getMessagesForPrompt('u1', 'chat');
      expect(messages).toHaveLength(4);
      expect(messages[0].content).toBe('first');
      expect(messages[3].content).toBe('resp-second');
    });

    it('keeps independent userId+phase buckets', async () => {
      await service.appendTurn('u1', 'registration', 'reg-msg', 'reg-resp');
      await service.appendTurn('u1', 'chat', 'chat-msg', 'chat-resp');
      await service.appendTurn('u2', 'chat', 'u2-msg', 'u2-resp');

      expect(await service.getMessagesForPrompt('u1', 'registration')).toHaveLength(2);
      expect(await service.getMessagesForPrompt('u1', 'chat')).toHaveLength(2);
      expect(await service.getMessagesForPrompt('u2', 'chat')).toHaveLength(2);
    });

    it('applies sliding window via maxTurns option', async () => {
      for (let i = 0; i < 5; i++) {
        await service.appendTurn('u1', 'chat', `msg-${i}`, `resp-${i}`);
      }

      const messages = await service.getMessagesForPrompt('u1', 'chat', { maxTurns: 2 });
      expect(messages).toHaveLength(4);
      expect(messages[0].content).toBe('msg-3');
      expect(messages[3].content).toBe('resp-4');
    });
  });
});
