import { PHASE_ENDED_PREFIX } from '@domain/conversation/ports';

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

    it('returns null for closed phases (PHASE_ENDED)', async() => {
      await service.appendTurn('u1', 'registration', 'hello', 'hi');
      await service.startNewPhase('u1', 'registration', 'chat', 'Reg complete.');

      expect(await service.getContext('u1', 'registration')).toBeNull();
    });

    it('scopes turns to current cycle on phase re-entry', async() => {
      // Cycle 1: chat → plan_creation
      await service.appendTurn('u1', 'chat', 'old-msg', 'old-resp');
      await service.startNewPhase('u1', 'chat', 'plan_creation', 'Planning started.');

      // Cycle 2: plan_creation → chat (re-entry)
      await service.appendTurn('u1', 'plan_creation', 'plan-msg', 'plan-resp');
      await service.startNewPhase('u1', 'plan_creation', 'chat', 'Back to chat.');

      // New chat cycle
      await service.appendTurn('u1', 'chat', 'new-msg', 'new-resp');

      const ctx = await service.getContext('u1', 'chat');
      expect(ctx).not.toBeNull();

      // Should only contain the current cycle: system note + new turn (3 turns)
      // Old cycle turns (old-msg, old-resp) must be excluded
      expect(ctx!.turns).toHaveLength(3);
      expect(ctx!.turns[0]).toMatchObject({ role: 'system', content: 'Back to chat.' });
      expect(ctx!.turns[1]).toMatchObject({ role: 'user', content: 'new-msg' });
      expect(ctx!.turns[2]).toMatchObject({ role: 'assistant', content: 'new-resp' });
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
      for (let i = 0; i < 15; i++) {
        await service.appendTurn('u1', 'chat', `msg-${i}`, `resp-${i}`);
      }

      const ctx = await service.getContext('u1', 'chat');
      const messages = service.getMessagesForPrompt(ctx!);

      expect(messages).toHaveLength(20);
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
      await service.startNewPhase('u1', 'registration', 'chat', 'Registration complete.');
      await service.appendTurn('u1', 'chat', 'hello', 'hi');

      const ctx = await service.getContext('u1', 'chat');
      const messages = service.getMessagesForPrompt(ctx!);

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({ role: 'system', content: 'Registration complete.' });
      expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
      expect(messages[2]).toEqual({ role: 'assistant', content: 'hi' });
    });

    it('excludes PHASE_ENDED markers from prompt', async() => {
      await service.appendTurn('u1', 'chat', 'msg1', 'resp1');

      const ctx = await service.getContext('u1', 'chat');
      // Inject a PHASE_ENDED marker into turns to verify filtering
      ctx!.turns.push({
        role: 'system',
        content: `${PHASE_ENDED_PREFIX} transition`,
        timestamp: new Date(),
      });

      const messages = service.getMessagesForPrompt(ctx!);
      const hasPhaseEnded = messages.some(m => m.content.startsWith(PHASE_ENDED_PREFIX));
      expect(hasPhaseEnded).toBe(false);
    });
  });

  // --- reset ---

  describe('reset', () => {
    it('is a no-op — context is preserved [BR-CONV-005]', async() => {
      await service.appendTurn('u1', 'chat', 'msg', 'resp');
      await service.reset('u1', 'chat');

      const ctx = await service.getContext('u1', 'chat');
      expect(ctx).not.toBeNull();
      expect(ctx!.turns).toHaveLength(2);
    });

    it('does not affect any context', async() => {
      await service.appendTurn('u1', 'chat', 'msg', 'resp');
      await service.appendTurn('u1', 'registration', 'reg', 'reg-resp');

      await service.reset('u1', 'chat');

      expect(await service.getContext('u1', 'chat')).not.toBeNull();
      expect(await service.getContext('u1', 'registration')).not.toBeNull();
    });

    it('is safe to call on non-existent context', async() => {
      await expect(service.reset('u1', 'chat')).resolves.toBeUndefined();
    });
  });

  // --- startNewPhase ---

  describe('startNewPhase', () => {
    it('marks old phase as ended and creates new with system note [S-0060, BR-CONV-005]', async() => {
      await service.appendTurn('u1', 'registration', 'reg-msg', 'reg-resp');

      await service.startNewPhase('u1', 'registration', 'chat', 'Registration complete.');

      // Old phase returns null (PHASE_ENDED marker is the last turn)
      expect(await service.getContext('u1', 'registration')).toBeNull();

      // New phase created with system note
      const ctx = await service.getContext('u1', 'chat');
      expect(ctx).not.toBeNull();
      expect(ctx!.phase).toBe('chat');
      expect(ctx!.turns).toHaveLength(1);
      expect(ctx!.turns[0]).toMatchObject({ role: 'system', content: 'Registration complete.' });
    });

    it('preserves old phase history (turns not deleted)', async() => {
      await service.appendTurn('u1', 'registration', 'reg-msg', 'reg-resp');
      await service.startNewPhase('u1', 'registration', 'chat', 'Complete.');

      // getContext returns null for the ended phase, but internally turns still exist.
      // Re-entering the phase reveals the preserved history.
      await service.startNewPhase('u1', 'chat', 'registration', 'Re-registering.');

      const ctx = await service.getContext('u1', 'registration');
      expect(ctx).not.toBeNull();
      // Current cycle starts from the re-entry system note only
      expect(ctx!.turns).toHaveLength(1);
      expect(ctx!.turns[0]).toMatchObject({ role: 'system', content: 'Re-registering.' });
    });

    it('handles phase re-entry correctly', async() => {
      // chat → plan_creation
      await service.appendTurn('u1', 'chat', 'chat1', 'resp1');
      await service.startNewPhase('u1', 'chat', 'plan_creation', 'Start plan.');

      // plan_creation → chat (back to chat)
      await service.appendTurn('u1', 'plan_creation', 'plan-msg', 'plan-resp');
      await service.startNewPhase('u1', 'plan_creation', 'chat', 'Back to chat.');

      await service.appendTurn('u1', 'chat', 'chat2', 'resp2');

      const chatCtx = await service.getContext('u1', 'chat');
      expect(chatCtx).not.toBeNull();
      // Current cycle: system note + chat2 turn = 3 turns
      expect(chatCtx!.turns[0]).toMatchObject({ role: 'system', content: 'Back to chat.' });
      expect(chatCtx!.turns[1]).toMatchObject({ role: 'user', content: 'chat2' });

      // plan_creation should be closed
      expect(await service.getContext('u1', 'plan_creation')).toBeNull();
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

      await expect(service.summarize('u1', 'chat')).resolves.toBeUndefined();

      const ctx = await service.getContext('u1', 'chat');
      expect(ctx!.turns).toHaveLength(2);
    });
  });
});
