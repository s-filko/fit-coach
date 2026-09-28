import type { User } from '@domain/user/services/user.service';

import { compose } from '@infra/ai/prompts/compose';

import { CHAT_PROMPT, type ChatPromptContextV2 } from '..';

const NOW = new Date('2026-09-13T10:00:00.000Z');

const makeUser = (overrides = {}) =>
  ({
    id: 'user-1',
    telegramUserId: BigInt(123),
    username: 'testuser',
    firstName: 'Alex',
    lastName: null,
    languageCode: 'en',
    profileStatus: 'complete' as const,
    age: 30,
    gender: 'male' as const,
    height: 180,
    weight: 80,
    fitnessLevel: 'intermediate' as const,
    fitnessGoal: 'Build muscle',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }) as User;

const ctx = (over: Partial<ChatPromptContextV2> = {}): ChatPromptContextV2 => ({
  now: NOW,
  timezone: null,
  client: 'telegram',
  user: null,
  lastMessageTime: null,
  hasActivePlan: false,
  ...over,
});

/**
 * phase.chat v2 (P4 context-budget plan, Task 2, D-B): client name, profile
 * and plan status moved to the `chat.context` domain block — v2 no longer
 * renders them. Byte-identity for the moved text is proven separately
 * (src/infra/ai/prompts/blocks/__tests__/chat-context.v1.unit.test.ts).
 */
describe('phase.chat v2 (ADR-0013 §5, BUG-009 guard section)', () => {
  it('returns a non-empty prompt', () => {
    const prompt = compose(CHAT_PROMPT.current.render(ctx({ user: makeUser() })));
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('the plan-status rule reflects hasActivePlan without rendering the moved context block', () => {
    const withoutPlan = compose(CHAT_PROMPT.current.render(ctx({ user: makeUser(), hasActivePlan: false })));
    expect(withoutPlan).toContain('Suggest creating a workout plan');

    const withPlan = compose(CHAT_PROMPT.current.render(ctx({ user: makeUser(), hasActivePlan: true })));
    expect(withPlan).toContain('IMMEDIATELY call request_transition({ toPhase: "session_planning" })');
  });

  it('includes language instruction from user language code', () => {
    const prompt = compose(CHAT_PROMPT.current.render(ctx({ user: makeUser({ languageCode: 'ru' }) })));
    expect(prompt).toContain('ru');
  });

  it('handles null user gracefully', () => {
    const prompt = compose(CHAT_PROMPT.current.render(ctx()));
    expect(prompt).toBeTruthy();
  });

  it('does not include JSON format instructions', () => {
    const prompt = compose(CHAT_PROMPT.current.render(ctx({ user: makeUser() })));
    expect(prompt).not.toContain('MUST respond with ONLY a valid JSON');
    expect(prompt).not.toContain('"message":');
  });

  it('always emits the no_set_logging section (BUG-009)', () => {
    const ids = CHAT_PROMPT.current.render(ctx({ hasActivePlan: false })).map(s => s.id);
    expect(ids).toContain('no_set_logging');
  });

  it('no longer renders the context section (moved to the chat.context domain block)', () => {
    const ids = CHAT_PROMPT.current.render(ctx({ user: makeUser() })).map(s => s.id);
    expect(ids).not.toContain('context');
  });
});
