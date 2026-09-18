/**
 * Localized error texts per conversation error code (AC-1354, D-F). The
 * server's route (`chat.routes.ts`, ADR-0013 §6) now returns
 * `{ error: { code } }` for a failed `/chat` call; this maps that code to a
 * user-facing message the bot can actually send.
 *
 * Deliberately duplicated, not imported, from the server's message catalog
 * (`infra/ai/messages/catalog.ts`) — `apps/bot` is a separate CommonJS
 * package with its own `package.json`/`tsconfig.json` and no path alias into
 * the server, so an import would not compile (D-F). The language rule is
 * mirrored exactly: `languageCode === 'ru'` selects ru, everything else
 * (including `undefined`/unset) falls back to en — same as the server's
 * `langOf`.
 */

export type ConversationErrorCode = 'LLM_UNAVAILABLE' | 'THREAD_BUSY' | 'CORE_ERROR';

interface Bilingual {
    en: string;
    ru: string;
}

const TEXTS: Record<ConversationErrorCode, Bilingual> = {
    LLM_UNAVAILABLE: {
        en: 'The AI coach is temporarily unavailable. Please try again in a minute.',
        ru: 'ИИ-тренер временно недоступен. Пожалуйста, попробуй ещё раз через минуту.',
    },
    THREAD_BUSY: {
        en: "You already have a message being processed. Please wait for that reply before sending another.",
        ru: 'Твоё предыдущее сообщение ещё обрабатывается. Пожалуйста, дождись ответа перед тем, как отправить новое.',
    },
    CORE_ERROR: {
        en: 'Something went wrong on our side. Please try again in a minute.',
        ru: 'Что-то пошло не так на нашей стороне. Пожалуйста, попробуй ещё раз через минуту.',
    },
};

/** Generic fallback for an unknown or absent code — distinct from every code above. */
const FALLBACK: Bilingual = {
    en: 'Sorry, an unexpected error occurred. Please try again in a minute.',
    ru: 'Извини, произошла непредвиденная ошибка. Пожалуйста, попробуй ещё раз через минуту.',
};

function isKnownCode(code: string): code is ConversationErrorCode {
    return code in TEXTS;
}

export function errorTextFor(code: string | undefined, languageCode: string | undefined): string {
    const lang: 'en' | 'ru' = languageCode === 'ru' ? 'ru' : 'en';
    const bilingual = code !== undefined && isKnownCode(code) ? TEXTS[code] : FALLBACK;
    return bilingual[lang];
}
