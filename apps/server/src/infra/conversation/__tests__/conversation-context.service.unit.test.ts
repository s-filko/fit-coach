import { ConversationContext, ConversationPhase } from '@domain/conversation/ports';

import { InMemoryConversationContextService } from '../conversation-context.service';

describe('InMemoryConversationContextService', () => {
  let service: InMemoryConversationContextService;

  beforeEach(() => {
    service = new InMemoryConversationContextService();
  });

  // --- getContext ---

  describe('getContext', () => {
    it('returns null for unknown userId+phase', async() => {
      const result = await service.getContext('unknown-user', 'chat');
      expect(result).toBeNull();
    });

    it('returns existing context after appendTurn', async() => {
      await service.appendTurn('u1', 'registration', 'hello', 'hi there');

      const ctx = await service.getContext('u1', 'registration');
      expect(ctx).not.toBeNull();
      expect(ctx!.userId).toBe('u1');
      expect(ctx!.phase).toBe('registration');
      expect(ctx!.turns).toHaveLength(2);
    });
  });

  // --- appendTurn ---

  describe('appendTurn', () => {
    it('creates context on first call [BR-CONV-002]', async() => {
      await service.appendTurn('u1', 'chat', 'msg1', 'resp1');

      const ctx = await service.getContext('u1', 'chat');
      expect(ctx).not.toBeNull();
      expect(ctx!.turns).toHaveLength(2);
      expect(ctx!.turns[0]).toMatchObject({ role: 'user', content: 'msg1' });
      expect(ctx!.turns[1]).toMatchObject({ role: 'assistant', content: 'resp1' });
    });

    it('appends to existing context', async() => {
      await service.appendTurn('u1', 'chat', 'msg1', 'resp1');
      await service.appendTurn('u1', 'chat', 'msg2', 'resp2');

      const ctx = await service.getContext('u1', 'chat');
      expect(ctx!.turns).toHaveLength(4);
    });

    it('preserves chronological order [INV-CONV-002]', async() => {
      await service.appendTurn('u1', 'chat', 'first', 'resp-first');
      await service.appendTurn('u1', 'chat', 'second', 'resp-second');

      const ctx = await service.getContext('u1', 'chat');
      expect(ctx!.turns[0].content).toBe('first');
      expect(ctx!.turns[1].content).toBe('resp-first');
      expect(ctx!.turns[2].content).toBe('second');
      expect(ctx!.turns[3].content).toBe('resp-second');
    });

    it('keeps independent (userId,phase) pairs [INV-CONV-001, AC-0112]', async() => {
      await service.appendTurn('u1', 'registration', 'reg-msg', 'reg-resp');
      await service.appendTurn('u1', 'chat', 'chat-msg', 'chat-resp');
      await service.appendTurn('u2', 'chat', 'u2-msg', 'u2-resp');

      const u1Reg = await service.getContext('u1', 'registration');
      const u1Chat = await service.getContext('u1', 'chat');
      const u2Chat = await service.getContext('u2', 'chat');

      expect(u1Reg!.turns).toHaveLength(2);
      expect(u1Chat!.turns).toHaveLength(2);
      expect(u2Chat!.turns).toHaveLength(2);

      expect(u1Reg!.turns[0].content).toBe('reg-msg');
      expect(u1Chat!.turns[0].content).toBe('chat-msg');
      expect(u2Chat!.turns[0].content).toBe('u2-msg');
    });

    it('updates lastActivityAt on each call', async() => {
      await service.appendTurn('u1', 'chat', 'msg1', 'resp1');
      const ctx1 = await service.getContext('u1', 'chat');
      const ts1 = ctx1!.lastActivityAt;

      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 10));
      await service.appendTurn('u1', 'chat', 'msg2', 'resp2');
      const ctx2 = await service.getContext('u1', 'chat');

      expect(ctx2!.lastActivityAt!.getTime()).toBeGreaterThanOrEqual(ts1!.getTime());
    });
  });

  // --- getMessagesForPrompt ---

  describe('getMessagesForPrompt', () => {
    it('returns all turns when under limit [S-0058]', async() => {
      await service.appendTurn('u1', 'chat', 'msg1', 'resp1');
      await service.appendTurn('u1', 'chat', 'msg2', 'resp2');

      const ctx = await service.getContext('u1', 'chat');
      const messages = service.getMessagesForPrompt(ctx!);

      expect(messages).toHaveLength(4);
      expect(messages[0]).toEqual({ role: 'user', content: 'msg1' });
      expect(messages[1]).toEqual({ role: 'assistant', content: 'resp1' });
      expect(messages[2]).toEqual({ role: 'user', content: 'msg2' });
      expect(messages[3]).toEqual({ role: 'assistant', content: 'resp2' });
    });

    it('applies sliding window of 20 by default [S-0059, AC-0111]', async() => {
      // Create 15 turns = 30 messages, window is 20
      for (let i = 0; i < 15; i++) {
        await service.appendTurn('u1', 'chat', `msg-${i}`, `resp-${i}`);
      }

      const ctx = await service.getContext('u1', 'chat');
      const messages = service.getMessagesForPrompt(ctx!);

      expect(messages).toHaveLength(20);
      // Should have the last 10 turns (20 messages), skipping first 5 turns
      expect(messages[0]).toEqual({ role: 'user', content: 'msg-5' });
      expect(messages[19]).toEqual({ role: 'assistant', content: 'resp-14' });
    });

    it('respects custom maxTurns [AC-0111]', async() => {
      for (let i = 0; i < 5; i++) {
        await service.appendTurn('u1', 'chat', `msg-${i}`, `resp-${i}`);
      }

      const ctx = await service.getContext('u1', 'chat');
      const messages = service.getMessagesForPrompt(ctx!, { maxTurns: 4 });

      expect(messages).toHaveLength(4);
      // Last 2 turns = 4 messages
      expect(messages[0]).toEqual({ role: 'user', content: 'msg-3' });
      expect(messages[3]).toEqual({ role: 'assistant', content: 'resp-4' });
    });

    it('prepends summarySoFar as system message [BR-CONV-004]', async() => {
      await service.appendTurn('u1', 'chat', 'msg1', 'resp1');

      const ctx = await service.getContext('u1', 'chat');
      ctx!.summarySoFar = 'Summary of previous conversation.';

      const messages = service.getMessagesForPrompt(ctx!);

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({ role: 'system', content: 'Summary of previous conversation.' });
      expect(messages[1]).toEqual({ role: 'user', content: 'msg1' });
      expect(messages[2]).toEqual({ role: 'assistant', content: 'resp1' });
    });

    it('preserves chronological order [S-0064]', async() => {
      await service.appendTurn('u1', 'chat', 'first', 'resp-first');
      await service.appendTurn('u1', 'chat', 'second', 'resp-second');

      const ctx = await service.getContext('u1', 'chat');
      const messages = service.getMessagesForPrompt(ctx!);

      const contents = messages.map(m => m.content);
      expect(contents).toEqual(['first', 'resp-first', 'second', 'resp-second']);
    });

    it('includes system turns from context', async() => {
      // startNewPhase creates a system turn
      await service.startNewPhase('u1', 'registration', 'chat', 'Registration complete.');
      await service.appendTurn('u1', 'chat', 'hello', 'hi');

      const ctx = await service.getContext('u1', 'chat');
      const messages = service.getMessagesForPrompt(ctx!);

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({ role: 'system', content: 'Registration complete.' });
      expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
      expect(messages[2]).toEqual({ role: 'assistant', content: 'hi' });
    });
  });

  // --- reset ---

  describe('reset', () => {
    it('clears target context [BR-CONV-005]', async() => {
      await service.appendTurn('u1', 'chat', 'msg', 'resp');
      await service.reset('u1', 'chat');

      const ctx = await service.getContext('u1', 'chat');
      expect(ctx).toBeNull();
    });

    it('does not affect other (userId,phase) pairs', async() => {
      await service.appendTurn('u1', 'chat', 'msg', 'resp');
      await service.appendTurn('u1', 'registration', 'reg', 'reg-resp');

      await service.reset('u1', 'chat');

      expect(await service.getContext('u1', 'chat')).toBeNull();
      expect(await service.getContext('u1', 'registration')).not.toBeNull();
    });

    it('is safe to call on non-existent context', async() => {
      await expect(service.reset('u1', 'chat')).resolves.toBeUndefined();
    });
  });

  // --- startNewPhase ---

  describe('startNewPhase', () => {
    it('resets old phase and creates new with system note [S-0060, BR-CONV-005]', async() => {
      await service.appendTurn('u1', 'registration', 'reg-msg', 'reg-resp');

      await service.startNewPhase('u1', 'registration', 'chat', 'Registration complete.');

      // Old phase removed
      expect(await service.getContext('u1', 'registration')).toBeNull();

      // New phase created with system note
      const ctx = await service.getContext('u1', 'chat');
      expect(ctx).not.toBeNull();
      expect(ctx!.phase).toBe('chat');
      expect(ctx!.turns).toHaveLength(1);
      expect(ctx!.turns[0]).toMatchObject({ role: 'system', content: 'Registration complete.' });
    });

    it('sets lastActivityAt on new phase', async() => {
      await service.startNewPhase('u1', 'registration', 'chat', 'note');

      const ctx = await service.getContext('u1', 'chat');
      expect(ctx!.lastActivityAt).toBeInstanceOf(Date);
    });
  });

  // --- summarize ---

  describe('summarize', () => {
    it('is a no-op stub for post-MVP [BR-CONV-006]', async() => {
      await service.appendTurn('u1', 'chat', 'msg', 'resp');

      // Should not throw and not modify context
      await expect(service.summarize('u1', 'chat')).resolves.toBeUndefined();

      const ctx = await service.getContext('u1', 'chat');
      expect(ctx!.turns).toHaveLength(2);
    });
  });
});
