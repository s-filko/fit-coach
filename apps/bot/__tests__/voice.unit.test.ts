/**
 * Pure voice helpers (voice-transcription plan Task 2, D7/D8): quote
 * formatting, escaping, length limits and the bilingual notices — no Telegram
 * and no network, everything is a string in / string out.
 */
import {
    escapeHtml,
    TELEGRAM_MAX_LENGTH,
    voiceNoticeFor,
    voiceReplyMessages,
} from '../voice';

describe('escapeHtml', () => {
    it('escapes &, < and >', () => {
        expect(escapeHtml('a & b <c> "d"')).toBe('a &amp; b &lt;c&gt; "d"');
    });

    it('leaves plain text untouched', () => {
        expect(escapeHtml('привет, сделай 5 подходов')).toBe('привет, сделай 5 подходов');
    });
});

describe('voiceReplyMessages (D7, AC-1416, BR-SPEECH-004/005)', () => {
    it('composes one message: quote + coach reply', () => {
        const messages = voiceReplyMessages('привет', 'Привет! Чем помочь?');
        expect(messages).toEqual(['<blockquote>🎤 привет</blockquote>\n\nПривет! Чем помочь?']);
    });

    it('escapes the transcript inside the quote', () => {
        const messages = voiceReplyMessages('<b>&hi</b>', 'ok');
        expect(messages[0]).toBe('<blockquote>🎤 &lt;b&gt;&amp;hi&lt;/b&gt;</blockquote>\n\nok');
    });

    it('wraps the quote in <blockquote expandable> when the transcript exceeds 500 chars', () => {
        const long = 'а'.repeat(501);
        const [composed] = voiceReplyMessages(long, 'ok');
        expect(composed.startsWith('<blockquote expandable>🎤')).toBe(true);
        expect(composed).toContain('</blockquote>\n\nok');
    });

    it('keeps a plain <blockquote> at exactly 500 chars', () => {
        const exactly = 'а'.repeat(500);
        const [composed] = voiceReplyMessages(exactly, 'ok');
        expect(composed.startsWith('<blockquote>🎤')).toBe(true);
    });

    it('cuts the displayed quote at 3500 chars with … (the coach still got the full text)', () => {
        const long = 'x'.repeat(4000);
        const [composed] = voiceReplyMessages(long, 'ok');
        const quote = composed.slice(0, composed.indexOf('</blockquote>'));
        expect(quote).toContain('…');
        // 3500 of escaped text + the expandable open tag + prefix/ellipsis
        expect(quote.length).toBeLessThanOrEqual('<blockquote expandable>🎤 '.length + 3500 + '…'.length);
    });

    it('R5: cuts the RAW transcript at 3500 chars, THEN escapes — an HTML entity is never split', () => {
        // '&' escapes to '&amp;' (5 chars). Cutting the escaped text at 3500
        // would split an entity in half ('&am…'), Telegram rejects the HTML and
        // sendHtml falls back to showing raw tags. The raw cut keeps every
        // entity whole.
        const long = '&&'.repeat(2000); // 4000 raw chars
        const [composed] = voiceReplyMessages(long, 'ok');
        const quote = composed.slice(0, composed.indexOf('</blockquote>'));

        expect(quote).toBe('<blockquote expandable>🎤 ' + '&amp;'.repeat(3500) + '…');
        expect(quote).not.toMatch(/&(a(?!mp)|l(?!t;)|g(?!t;))/); // no partial entity
    });

    it('returns only the quote when the coach reply is empty (the user still sees what was heard)', () => {
        expect(voiceReplyMessages('привет', '')).toEqual(['<blockquote>🎤 привет</blockquote>']);
        expect(voiceReplyMessages('привет', '   \n')).toEqual(['<blockquote>🎤 привет</blockquote>']);
    });

    it('splits into two messages when the composed reply exceeds 4096 chars: quote first, then the reply', () => {
        const coachReply = 'y'.repeat(4100);
        const [first, second, third] = voiceReplyMessages('привет', coachReply);
        expect(first).toBe('<blockquote>🎤 привет</blockquote>');
        expect(second).toBe(coachReply);
        expect(third).toBeUndefined();
        expect(first.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH);
        // The reply itself is sent as-is (same as today's text path) — the split
        // only moves the quote out of the composed message.
    });

    it('never composes a message over 4096 chars when both parts are long', () => {
        const transcript = 'x'.repeat(4000); // display-cut to 3500
        const coachReply = 'y'.repeat(4090);
        const messages = voiceReplyMessages(transcript, coachReply);
        expect(messages).toHaveLength(2);
        for (const m of messages) {
            expect(m.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH);
        }
    });
});

describe('voiceNoticeFor (D8, AC-1417, AC-1418, AC-1419, BR-SPEECH-007)', () => {
    it.each(['NO_SPEECH', 'STT_UNAVAILABLE', 'TOO_LONG'] as const)('%s: ru for ru, en fallback otherwise', kind => {
        const ru = voiceNoticeFor(kind, 'ru');
        const en = voiceNoticeFor(kind, 'en');
        expect(ru).not.toBe(en);
        expect(voiceNoticeFor(kind, undefined)).toBe(en);
    });

    it('NO_SPEECH says the voice could not be made out and suggests typing', () => {
        expect(voiceNoticeFor('NO_SPEECH', 'en')).toContain('voice message');
        expect(voiceNoticeFor('NO_SPEECH', 'ru')).toContain('голосовое');
    });

    it('STT_UNAVAILABLE asks to type instead', () => {
        expect(voiceNoticeFor('STT_UNAVAILABLE', 'en')).toContain('unavailable');
        expect(voiceNoticeFor('STT_UNAVAILABLE', 'ru')).toContain('напиши');
    });

    it('TOO_LONG states the 5-minute limit', () => {
        expect(voiceNoticeFor('TOO_LONG', 'en')).toContain('5 minutes');
        expect(voiceNoticeFor('TOO_LONG', 'ru')).toContain('5 минут');
    });
});
