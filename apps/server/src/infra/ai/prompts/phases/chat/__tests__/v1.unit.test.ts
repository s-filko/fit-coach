import type { User } from '@domain/user/services/user.service';

import { compose } from '@infra/ai/prompts/compose';

import { CHAT_PROMPT, type ChatPromptContext } from '..';

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

const ctx = (over: Partial<ChatPromptContext> = {}): ChatPromptContext => ({
  now: NOW,
  timezone: null,
  client: 'telegram',
  user: null,
  lastMessageTime: null,
  hasActivePlan: false,
  recentSessions: [],
  ...over,
});

describe('phase.chat v1 (ADR-0013 §5, BUG-009 guard section)', () => {
  it('returns a non-empty prompt', () => {
    const prompt = compose(CHAT_PROMPT.current.render(ctx({ user: makeUser() })));
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes client name in prompt', () => {
    const prompt = compose(CHAT_PROMPT.current.render(ctx({ user: makeUser({ firstName: 'John' }) })));
    expect(prompt).toContain('John');
  });

  it('mentions plan status when no active plan', () => {
    const prompt = compose(CHAT_PROMPT.current.render(ctx({ user: makeUser() })));
    expect(prompt).toContain('DOES NOT have a workout plan');
  });

  it('mentions plan status when active plan exists', () => {
    const prompt = compose(CHAT_PROMPT.current.render(ctx({ user: makeUser(), hasActivePlan: true })));
    expect(prompt).toContain('HAS an active workout plan');
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
});
