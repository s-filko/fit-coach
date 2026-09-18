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
  // translations of the en guard literals (2026-09) — new user-facing text for the owner to review
  context_cleared: 'Контекст диалога очищен.',
  training_no_active_session: 'Нет активной тренировки. Сначала начни тренировку.',
  training_session_not_found: 'Тренировка не найдена. Возможно, она уже завершена.',
  // new user-facing text (2026-09) — D-D empty-reply fallback, for the owner to review
  empty_reply: 'Не получилось придумать ответ. Отправь сообщение ещё раз, пожалуйста.',
  // translation of the en originals (2026-09)
  session_ended_return_to_chat: 'Тренировка завершена. Готов к новой?',
  session_missing_return_to_chat: 'Не удалось возобновить тренировку. Можешь запланировать новую, когда будешь готов.',
};
