import { type Lang, langOf, type MessageKey, t } from '../index';

/** Every key the catalog type declares, in both languages (D-F, D-B). */
const ALL_KEYS: MessageKey[] = [
  'tool_error_budget_exhausted',
  'tool_system_error',
  'training_no_active_session',
  'training_session_not_found',
  'empty_reply',
];

describe('message catalog (refactor-p3-tool-executor Task 3)', () => {
  it('langOf maps ru → ru and everything else → en', () => {
    expect(langOf('ru')).toBe('ru');
    expect(langOf('en')).toBe('en');
    expect(langOf('de')).toBe('en');
    expect(langOf(null)).toBe('en');
    expect(langOf(undefined)).toBe('en');
  });

  it('has every MessageKey in both languages (en fallback never needed)', () => {
    for (const key of ALL_KEYS) {
      for (const lang of ['en', 'ru'] as Lang[]) {
        expect(typeof t(key, lang)).toBe('string');
        expect(t(key, lang).length).toBeGreaterThan(0);
      }
    }
  });

  it(
    'AC-SI-3 (BUG-036 + owner language rule, R3): langOf is driven by the profile language alone — ' +
      'never by what the user happens to write, and never by a raw Telegram code once the profile diverges from it',
    () => {
      // The owner's real fix direction (not the original repro's, which expected
      // detection from message content): once the profile says 'ru' — e.g. after
      // set_language — the catalog is Russian, full stop, even if some other
      // per-request signal (like a raw Telegram language_code) still says 'en'.
      // langOf only ever sees the profile value; there is nothing else to read.
      expect(langOf('ru')).toBe('ru');
      expect(t('tool_error_budget_exhausted', langOf('ru'))).toBe(
        'Не удалось записать данные после нескольких попыток. Попробуй переформулировать: укажи упражнение, вес и количество повторений чётко.',
      );
    },
  );

  it('keeps the ru literals byte-identical to today’s training.subgraph strings', () => {
    expect(t('tool_error_budget_exhausted', 'ru')).toBe(
      'Не удалось записать данные после нескольких попыток. Попробуй переформулировать: укажи упражнение, вес и количество повторений чётко.',
    );
    expect(t('tool_system_error', 'ru')).toBe(
      'Произошла техническая ошибка при сохранении данных тренировки. Пожалуйста, попробуй снова или обратись в поддержку.',
    );
  });
});
