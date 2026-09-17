import { en } from './en';
import { ru } from './ru';

/**
 * User-facing message catalog (ADR-0013 §11 `infra/ai/messages/`). Grows in
 * refactor-p3-run-context-commit (router replies); created here with the
 * executor's two keys (decision D-E) and the training loader guards (D-B) so
 * the inline-prompt rails cover the directory from the first commit.
 */
export type MessageKey =
  | 'tool_error_budget_exhausted'
  | 'tool_system_error'
  | 'training_no_active_session'
  | 'training_session_not_found'
  | 'empty_reply';

export type Lang = 'en' | 'ru';

/** Catalog language driven by Telegram's `language_code`; English fallback. */
export function langOf(languageCode: string | null | undefined): Lang {
  return languageCode === 'ru' ? 'ru' : 'en';
}

/** Looks up a message; falls back to English if a key is missing in `ru`. */
export function t(key: MessageKey, lang: Lang): string {
  const dict = lang === 'ru' ? ru : en;
  return dict[key] ?? en[key];
}
