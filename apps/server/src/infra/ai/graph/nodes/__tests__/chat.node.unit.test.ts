import { buildChatSystemPrompt } from '../chat.node';

const makeUser = (overrides = {}) => ({
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
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('buildChatSystemPrompt', () => {
  it('returns a non-empty prompt', () => {
    const prompt = buildChatSystemPrompt(makeUser(), false);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes client name in prompt', () => {
    const prompt = buildChatSystemPrompt(makeUser({ firstName: 'John' }), false);
    expect(prompt).toContain('John');
  });

  it('mentions plan status when no active plan', () => {
    const prompt = buildChatSystemPrompt(makeUser(), false);
    expect(prompt).toContain('DOES NOT have a workout plan');
  });

  it('mentions plan status when active plan exists', () => {
    const prompt = buildChatSystemPrompt(makeUser(), true);
    expect(prompt).toContain('HAS an active workout plan');
  });

  it('includes language instruction from user language code', () => {
    const prompt = buildChatSystemPrompt(makeUser({ languageCode: 'ru' }), false);
    expect(prompt).toContain('ru');
  });

  it('handles null user gracefully', () => {
    const prompt = buildChatSystemPrompt(null, false);
    expect(prompt).toBeTruthy();
  });

  it('does not include JSON format instructions', () => {
    const prompt = buildChatSystemPrompt(makeUser(), false);
    expect(prompt).not.toContain('MUST respond with ONLY a valid JSON');
    expect(prompt).not.toContain('"message":');
  });
});
