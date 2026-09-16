import {
  DEFAULT_DIRECTIVES_V1,
  DIRECTIVES_WITHOUT_IDENTITY_V1,
  FORMATTING_TELEGRAM_V1,
  GREETING_V1,
  IDENTITY_V1,
  LANGUAGE_V1,
  OUTPUT_V1,
  TIMEZONE_V1,
} from '..';
import { compose, renderDirectives } from '../../compose';
import type { DirectiveContext } from '../../types';

const NOW = new Date('2026-09-13T10:00:00.000Z');
const ctx = (over: Partial<DirectiveContext> = {}): DirectiveContext => ({
  now: NOW,
  timezone: null,
  client: 'telegram',
  user: null,
  lastMessageTime: null,
  ...over,
});
const user = { id: 'u', profileStatus: 'complete', languageCode: 'ru', timezone: 'Europe/Berlin' } as never;

describe('directive modules v1 (ADR-0013 §5, BR-LLM-007 — pure, versioned directives)', () => {
  it('identity names FitCoach and forbids AI mentions', () => {
    const { text } = IDENTITY_V1.render(ctx())!;
    expect(text).toContain('FitCoach');
    expect(text).toContain('NOT an AI assistant');
  });

  it('formatting.telegram has the FORMATTING header and forbids Markdown', () => {
    const { text } = FORMATTING_TELEGRAM_V1.render(ctx())!;
    expect(text).toContain('=== FORMATTING ===');
    expect(text).toContain('Do NOT use Markdown');
  });

  it('language uses the user language code, else the generic instruction', () => {
    expect(LANGUAGE_V1.render(ctx({ user }))!.text).toContain("'ru'");
    expect(LANGUAGE_V1.render(ctx())!.text).toContain('same language the user writes in');
  });

  it('timezone uses the user timezone, else asks for it', () => {
    expect(TIMEZONE_V1.render(ctx({ user }))!.text).toContain('Europe/Berlin');
    expect(TIMEZONE_V1.render(ctx())!.text).toContain('unknown');
  });

  it('output forbids JSON', () => {
    expect(OUTPUT_V1.render(ctx())!.text).toContain('Do NOT include JSON');
  });

  it('greeting applies only on a new calendar day and after 4 hours, using ctx.now', () => {
    expect(GREETING_V1.render(ctx({ lastMessageTime: null }))).toBeNull();
    expect(GREETING_V1.render(ctx({ lastMessageTime: new Date('2026-09-13T08:00:00.000Z') }))).toBeNull();
    expect(GREETING_V1.render(ctx({ lastMessageTime: new Date('2026-09-12T08:00:00.000Z') }))!.text).toContain(
      'GREETING',
    );
  });

  it('DEFAULT_DIRECTIVES_V1 reproduces the pre-refactor order; the no-identity variant drops only identity', () => {
    expect(DEFAULT_DIRECTIVES_V1.map(d => d.id)).toEqual([
      'identity',
      'greeting',
      'language',
      'timezone',
      'name-usage',
      'formatting.telegram',
      'time-reference',
      'output',
      'tool-reply',
    ]);
    expect(DIRECTIVES_WITHOUT_IDENTITY_V1.map(d => d.id)).toEqual(DEFAULT_DIRECTIVES_V1.map(d => d.id).slice(1));
    const text = compose(renderDirectives(DEFAULT_DIRECTIVES_V1, ctx()));
    expect(text.startsWith('You are FitCoach')).toBe(true);
    expect(text.endsWith('text: ""  ← empty, user sees nothing')).toBe(true);
  });

  it('every directive is v1', () => {
    for (const d of DEFAULT_DIRECTIVES_V1) {
      expect(d.version).toBe('v1');
    }
  });
});
