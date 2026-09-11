import {
  composeDirectives,
  formattingDirective,
  identityDirective,
  languageDirective,
  nameUsageDirective,
  outputDirective,
} from '../prompt-directives';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const makeUser = (overrides = {}) => ({
  id: 'user-1',
  username: 'testuser',
  firstName: 'Alex',
  lastName: null,
  languageCode: 'en' as string | null,
  profileStatus: 'complete' as const,
  age: 30,
  gender: 'male' as const,
  height: 180,
  weight: 80,
  fitnessLevel: 'intermediate' as const,
  fitnessGoal: 'Build muscle',
  ...overrides,
});

describe('prompt-directives', () => {
  describe('identityDirective', () => {
    it('includes FitCoach identity', () => {
      const result = identityDirective();
      expect(result).toContain('FitCoach');
      expect(result).toContain('fitness coach');
    });

    it('prohibits AI mentions', () => {
      const result = identityDirective();
      expect(result).toContain('Never mention AI');
    });
  });

  describe('formattingDirective', () => {
    it('includes HTML examples', () => {
      const result = formattingDirective();
      expect(result).toContain('<b>bold</b>');
      expect(result).toContain('<i>italic</i>');
    });

    it('prohibits Markdown syntax', () => {
      const result = formattingDirective();
      expect(result).toContain('Do NOT use Markdown');
      expect(result).toContain('**bold**');
    });

    it('includes FORMATTING section header', () => {
      const result = formattingDirective();
      expect(result).toContain('=== FORMATTING ===');
    });
  });

  describe('languageDirective', () => {
    it('uses language code when available', () => {
      const result = languageDirective(makeUser({ languageCode: 'ru' }));
      expect(result).toMatch(/ru/);
      expect(result).toContain('Always respond in this language');
    });

    it('falls back to generic instruction when no language code', () => {
      const result = languageDirective(makeUser({ languageCode: null }));
      expect(result).toContain('same language the user writes in');
    });

    it('handles null user', () => {
      const result = languageDirective(null);
      expect(result).toContain('same language the user writes in');
    });
  });

  describe('nameUsageDirective', () => {
    it('restricts name usage to sparingly', () => {
      const result = nameUsageDirective();
      expect(result).toContain('SPARINGLY');
      expect(result).toContain('Do NOT repeat the name');
    });
  });

  describe('outputDirective', () => {
    it('prohibits JSON in response', () => {
      const result = outputDirective();
      expect(result).toContain('Do NOT include JSON');
    });
  });

  describe('composeDirectives', () => {
    it('includes all directives by default', () => {
      const result = composeDirectives(makeUser());
      expect(result).toContain('FitCoach');
      expect(result).toContain('SPARINGLY');
      expect(result).toContain('=== FORMATTING ===');
      expect(result).toMatch(/en/);
      expect(result).toContain('Do NOT include JSON');
    });

    it('excludes identity when includeIdentity is false', () => {
      const result = composeDirectives(makeUser(), { includeIdentity: false });
      expect(result).not.toContain('FitCoach');
      expect(result).toContain('=== FORMATTING ===');
      expect(result).toContain('Do NOT include JSON');
    });

    it('handles null user', () => {
      const result = composeDirectives(null);
      expect(result).toContain('FitCoach');
      expect(result).toContain('same language the user writes in');
    });
  });
});
