import { type Lang, type MessageKey, langOf, t } from '../index';

/** Every key the catalog type declares, in both languages (D-F). */
const ALL_KEYS: MessageKey[] = ['tool_error_budget_exhausted', 'tool_system_error'];

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

  it('keeps the ru literals byte-identical to today’s training.subgraph strings', () => {
    expect(t('tool_error_budget_exhausted', 'ru')).toBe(
      'Не удалось записать данные после нескольких попыток. Попробуй переформулировать: укажи упражнение, вес и количество повторений чётко.',
    );
    expect(t('tool_system_error', 'ru')).toBe(
      'Произошла техническая ошибка при сохранении данных тренировки. Пожалуйста, попробуй снова или обратись в поддержку.',
    );
  });
});
