import { DEFAULT_DIRECTIVES_V1, DEFAULT_DIRECTIVES_V2, LANGUAGE_V1, LANGUAGE_V2 } from '..';
import type { DirectiveContext } from '../../types';

const ctx = (over: Partial<DirectiveContext> = {}): DirectiveContext => ({
  now: new Date('2026-09-25T10:00:00.000Z'),
  timezone: null,
  client: 'telegram',
  user: null,
  lastMessageTime: null,
  ...over,
});

const user = { id: 'u', profileStatus: 'complete', languageCode: 'ru' } as never;

describe('LANGUAGE_V2 (BUG-036 + owner language rule, R3 — profile is the only source)', () => {
  it("renders the user's profile language with no 'from Telegram' wording", () => {
    const { text } = LANGUAGE_V2.render(ctx({ user }))!;
    expect(text).toBe("USER LANGUAGE: 'ru'. Always respond in this language.");
    expect(text).not.toContain('Telegram');
  });

  it('falls back to the same generic instruction as V1 when no profile language is known', () => {
    expect(LANGUAGE_V2.render(ctx())!.text).toBe(LANGUAGE_V1.render(ctx())!.text);
  });

  it('is v2 and keeps the language directive id', () => {
    expect(LANGUAGE_V2.version).toBe('v2');
    expect(LANGUAGE_V2.render(ctx({ user }))!.id).toBe('directive.language');
  });

  it('DEFAULT_DIRECTIVES_V2 uses LANGUAGE_V2 in the language slot; V1 keeps LANGUAGE_V1 untouched (AC-1321 frozen snapshots)', () => {
    expect(DEFAULT_DIRECTIVES_V2[2]).toBe(LANGUAGE_V2);
    expect(DEFAULT_DIRECTIVES_V1[2]).toBe(LANGUAGE_V1);
    expect(DEFAULT_DIRECTIVES_V2.map(d => d.id)).toEqual(DEFAULT_DIRECTIVES_V1.map(d => d.id).concat('current-time'));
  });
});
