import type { MessageKey } from './catalog';

/**
 * Russian catalog entries. The two executor keys keep today's
 * training.subgraph.ts literals byte-for-byte (refactor-p3-tool-executor
 * Task 3) — the strings moved, they did not change.
 */
export const ru: Record<MessageKey, string> = {
  tool_error_budget_exhausted:
    'Не удалось записать данные после нескольких попыток. Попробуй переформулировать: укажи упражнение, вес и количество повторений чётко.',
  tool_system_error:
    'Произошла техническая ошибка при сохранении данных тренировки. Пожалуйста, попробуй снова или обратись в поддержку.',
};
