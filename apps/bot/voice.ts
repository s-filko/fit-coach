/**
 * Voice-message helpers (voice-transcription plan Task 2, D7/D8): pure
 * formatting and localized notices — no Telegram calls, no imports with side
 * effects. The handler in `handlers.ts` owns all IO.
 *
 * D7: one message — `<blockquote>🎤 {escaped transcript}</blockquote>` followed
 * by the coach's reply. Transcript > 500 chars → `<blockquote expandable>`; the
 * displayed quote is cut at 3500 chars with `…` (the coach always gets the full
 * text). Composed message over Telegram's 4096 → two messages, the quote first.
 * Empty coach reply → only the quote (the user still sees what was heard).
 */

/** Telegram's hard limit for one message. */
export const TELEGRAM_MAX_LENGTH = 4096;

/** Transcript longer than this (raw chars) renders as an expandable quote. */
const EXPANDABLE_THRESHOLD = 500;

/** The displayed quote body is cut here (escaped chars) with an ellipsis. */
const DISPLAY_CUT = 3500;

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The quote body: the RAW transcript cut at 3500 chars with `…`, THEN escaped.
 * R5 (Task 3): cutting after escaping could split an HTML entity in half
 * (`&am…`) — Telegram rejects the HTML and `sendHtml` falls back to showing
 * raw tags. Cutting first keeps every entity whole.
 */
function quoteBody(transcript: string): string {
    const raw = transcript.length > DISPLAY_CUT ? transcript.slice(0, DISPLAY_CUT) + '…' : transcript;
    return escapeHtml(raw);
}

/** The full quote line exactly as it goes into a Telegram message. */
export function quoteLine(transcript: string): string {
    const open = transcript.length > EXPANDABLE_THRESHOLD ? '<blockquote expandable>' : '<blockquote>';
    // The closing tag is always plain </blockquote> — Telegram rejects </blockquote expandable>.
    return `${open}🎤 ${quoteBody(transcript)}</blockquote>`;
}

/**
 * The messages to send for one voice reply, in order: a single composed
 * message when it fits, otherwise the quote first and the coach reply
 * separately (D7); only the quote when the coach reply is empty.
 */
export function voiceReplyMessages(transcript: string, coachReply: string): string[] {
    const quote = quoteLine(transcript);
    const reply = coachReply.trim();
    if (!reply) {
        return [quote];
    }
    const composed = `${quote}\n\n${reply}`;
    if (composed.length <= TELEGRAM_MAX_LENGTH) {
        return [composed];
    }
    return [quote, reply];
}

/**
 * D8 notices, bilingual like `error-text.ts`: ru when the PROFILE language is
 * 'ru', everything else (including undefined) falls back to en — the same rule.
 */
export type VoiceNoticeKind = 'NO_SPEECH' | 'STT_UNAVAILABLE' | 'TOO_LONG';

const NOTICES: Record<VoiceNoticeKind, { en: string; ru: string }> = {
    NO_SPEECH: {
        en: "I couldn't make out your voice message. Please try again, or just type it.",
        ru: 'Не получилось разобрать голосовое сообщение. Попробуй ещё раз или просто напиши текстом.',
    },
    STT_UNAVAILABLE: {
        en: 'Voice recognition is unavailable right now — please type your message.',
        ru: 'Распознавание голоса сейчас недоступно — пожалуйста, напиши сообщение текстом.',
    },
    TOO_LONG: {
        en: 'I can handle voice messages up to 5 minutes — please send a shorter one or type it.',
        ru: 'Я понимаю голосовые сообщения длиной до 5 минут — отправь покороче или напиши текстом.',
    },
};

export function voiceNoticeFor(kind: VoiceNoticeKind, languageCode: string | undefined): string {
    const lang = languageCode === 'ru' ? 'ru' : 'en';
    return NOTICES[kind][lang];
}
