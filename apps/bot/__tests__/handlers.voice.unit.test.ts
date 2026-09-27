/**
 * msg.voice handling (voice-transcription plan Task 2, D6/D8, AC-VT-4/5): the
 * real registerBotHandlers runs against a fake Telegram emitter; only the
 * external IO is mocked — axios (server transport) and the bot's sendMessage /
 * sendChatAction / getFileStream. No network, no Telegram.
 */
import { EventEmitter } from 'events';

import { AxiosError } from 'axios';
import type TelegramBot from 'node-telegram-bot-api';
import type { Readable } from 'stream';

const mockPost = jest.fn();
jest.mock('axios', () => {
    const original = jest.requireActual('axios');
    return {
        ...original,
        create: jest.fn(() => ({
            post: (...args: unknown[]) => mockPost(...args),
        })),
        isAxiosError: original.isAxiosError,
    };
});

jest.mock('../logger', () => ({
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { registerBotHandlers } from '../handlers';

function fakeStream(data: Buffer): Readable {
    return {
        async *[Symbol.asyncIterator]() {
            yield data;
        },
    } as unknown as Readable;
}

const AUDIO = Buffer.from('fake-ogg-bytes');
const AUDIO_BASE64 = AUDIO.toString('base64');

let nextSenderId = 100;
function voiceMessage(overrides: Partial<TelegramBot.Message> = {}): TelegramBot.Message {
    return {
        message_id: 1,
        date: Date.now(),
        chat: { id: nextSenderId, type: 'private' },
        from: { id: nextSenderId, is_bot: false, first_name: 'Иван', language_code: 'ru' },
        voice: {
            duration: 6,
            mime_type: 'audio/ogg',
            file_id: 'FID123',
            file_unique_id: 'UID123',
            file_size: 12345,
        },
        ...overrides,
    } as TelegramBot.Message;
}

const htmlOptions = { parse_mode: 'HTML' } as const;

describe('bot voice handling (AC-VT-4/5; AC-1415, AC-1416, AC-1417, AC-1418, AC-1419, AC-1420)', () => {
    let bot: TelegramBot & EventEmitter;

    beforeEach(() => {
        nextSenderId += 10;
        jest.clearAllMocks();
        bot = new EventEmitter() as unknown as TelegramBot & EventEmitter;
        bot.sendMessage = jest.fn().mockResolvedValue({ message_id: 123 });
        bot.sendChatAction = jest.fn().mockResolvedValue(true);
        bot.getFileStream = jest.fn().mockReturnValue(fakeStream(AUDIO));
        registerBotHandlers(bot);
    });

    const emitAndSettle = async (msg: TelegramBot.Message) => {
        bot.emit('message', msg);
        await new Promise(resolve => setTimeout(resolve, 50));
    };

    const flush = (data: unknown, status = 200) => ({
        data,
        ...(status !== 200 ? { isAxiosError: true } : {}),
    });

    const axiosError = (status: number, data: unknown): AxiosError =>
        new AxiosError('err', String(status), undefined, undefined, { status, data } as never);

    it('voice → download, transcribe, chat with the transcript, reply = quote + coach reply', async () => {
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u1' } }))                                 // /api/bot/user
            .mockResolvedValueOnce(flush({ data: { text: 'сделай 5 подходов' } }))                 // /voice/transcribe
            .mockResolvedValueOnce(flush({ data: { content: 'Отлично, начинаем!' } }));            // /chat

        await emitAndSettle(voiceMessage());

        expect(bot.getFileStream).toHaveBeenCalledWith('FID123');
        expect(mockPost).toHaveBeenCalledWith('/api/bot/voice/transcribe', {
            userId: 'u1',
            audioBase64: AUDIO_BASE64,
            mimeType: 'audio/ogg',
        });
        // D5: the transcript goes to /chat unchanged
        expect(mockPost).toHaveBeenCalledWith('/api/bot/chat', { userId: 'u1', message: 'сделай 5 подходов' });
        expect(bot.sendMessage).toHaveBeenCalledWith(
            nextSenderId,
            '<blockquote>🎤 сделай 5 подходов</blockquote>\n\nОтлично, начинаем!',
            htmlOptions,
        );
    });

    it('duration > 300 s: sends the localized too-long text, no download, no API call', async () => {
        await emitAndSettle(voiceMessage({ voice: { duration: 301, file_id: 'F', file_unique_id: 'U', file_size: 1 } as TelegramBot.Voice }));

        expect(bot.getFileStream).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
        expect(bot.sendMessage).toHaveBeenCalledWith(nextSenderId, expect.stringContaining('5 минут'));
        expect(bot.sendMessage).toHaveBeenCalledWith(nextSenderId, expect.not.stringContaining('5 minutes'));
    });

    it('too-long text is English when the profile language is not ru', async () => {
        await emitAndSettle(voiceMessage({
            from: { id: 101, is_bot: false, first_name: 'J', language_code: 'en' },
            voice: { duration: 500, file_id: 'F', file_unique_id: 'U', file_size: 1 } as TelegramBot.Voice,
        }));

        expect(bot.sendMessage).toHaveBeenCalledWith(nextSenderId, expect.stringContaining('5 minutes'));
    });

    it('R6: duration < 1 s (accidental tap) → NO_SPEECH notice, no download, no API call', async () => {
        await emitAndSettle(voiceMessage({ voice: { duration: 0, file_id: 'F', file_unique_id: 'U', file_size: 1 } as TelegramBot.Voice }));

        expect(bot.getFileStream).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
        expect(bot.sendMessage).toHaveBeenCalledTimes(1);
        expect(bot.sendMessage).toHaveBeenCalledWith(nextSenderId, expect.stringContaining('голосовое'));
    });

    it('422 NO_SPEECH: sends the notice, chat is NOT called', async () => {
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u2' } }))
            .mockRejectedValueOnce(axiosError(422, { error: { code: 'NO_SPEECH' } }));

        await emitAndSettle(voiceMessage());

        expect(mockPost).toHaveBeenCalledTimes(2);
        expect(bot.sendMessage).toHaveBeenCalledWith(nextSenderId, expect.stringContaining('голосовое'));
        expect(bot.sendMessage).not.toHaveBeenCalledWith(nextSenderId, expect.anything(), htmlOptions);
    });

    it('503 STT_UNAVAILABLE: sends the notice, chat is NOT called', async () => {
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u3' } }))
            .mockRejectedValueOnce(axiosError(503, { error: { code: 'STT_UNAVAILABLE' } }));

        await emitAndSettle(voiceMessage());

        expect(mockPost).toHaveBeenCalledTimes(2);
        expect(bot.sendMessage).toHaveBeenCalledWith(nextSenderId, expect.stringContaining('напиши'));
    });

    it('network failure on the transcribe call counts as STT_UNAVAILABLE, chat is NOT called', async () => {
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u4' } }))
            .mockRejectedValueOnce(new Error('ECONNRESET'));

        await emitAndSettle(voiceMessage());

        expect(mockPost).toHaveBeenCalledTimes(2);
        expect(bot.sendMessage).toHaveBeenCalledWith(nextSenderId, expect.stringContaining('недоступно'));
    });

    it('chat error after a successful transcription: quote first, then the standard error text (D8)', async () => {
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u5' } }))
            .mockResolvedValueOnce(flush({ data: { text: 'привет' } }))
            .mockRejectedValueOnce(axiosError(409, { error: { code: 'THREAD_BUSY' } }));

        await emitAndSettle(voiceMessage());

        expect(bot.sendMessage).toHaveBeenCalledTimes(2);
        expect(bot.sendMessage).toHaveBeenNthCalledWith(1, nextSenderId, '<blockquote>🎤 привет</blockquote>', htmlOptions);
        expect(bot.sendMessage).toHaveBeenNthCalledWith(
            2,
            nextSenderId,
            expect.stringContaining('Твоё предыдущее сообщение ещё обрабатывается'),
        );
    });

    it('A10 (Task 4): a Telegram send failure after a successful chat is not a chat error', async () => {
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u5b' } }))
            .mockResolvedValueOnce(flush({ data: { text: 'привет' } }))
            .mockResolvedValueOnce(flush({ data: { content: 'ответ тренера' } }));
        // The reply send itself fails — Telegram is unreachable, not the chat.
        (bot.sendMessage as jest.Mock).mockRejectedValueOnce(new Error('ETELEGRAM 502'));

        await emitAndSettle(voiceMessage());

        // Only the failed reply send — no second quote, no chat-error text.
        expect(bot.sendMessage).toHaveBeenCalledTimes(1);
        const { log } = jest.requireMock('../logger') as { log: { error: jest.Mock } };
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.objectContaining({ message: 'ETELEGRAM 502' }) }),
            expect.stringContaining('sending the voice reply failed'),
        );
        expect(log.error).not.toHaveBeenCalledWith(expect.anything(), 'voice chat processing failed');
    });

    it('empty coach reply: only the quote is sent, chat was called with the transcript', async () => {
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u6' } }))
            .mockResolvedValueOnce(flush({ data: { text: 'привет' } }))
            .mockResolvedValueOnce(flush({ data: { content: '   ' } }));

        await emitAndSettle(voiceMessage());

        expect(mockPost).toHaveBeenCalledWith('/api/bot/chat', { userId: 'u6', message: 'привет' });
        expect(bot.sendMessage).toHaveBeenCalledTimes(1);
        expect(bot.sendMessage).toHaveBeenCalledWith(nextSenderId, '<blockquote>🎤 привет</blockquote>', htmlOptions);
    });

    it('composed message over 4096 chars: the quote goes first, the coach reply separately', async () => {
        const longReply = 'й'.repeat(4100);
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u7' } }))
            .mockResolvedValueOnce(flush({ data: { text: 'привет' } }))
            .mockResolvedValueOnce(flush({ data: { content: longReply } }));

        await emitAndSettle(voiceMessage());

        expect(bot.sendMessage).toHaveBeenCalledTimes(2);
        expect(bot.sendMessage).toHaveBeenNthCalledWith(1, nextSenderId, '<blockquote>🎤 привет</blockquote>', htmlOptions);
        expect(bot.sendMessage).toHaveBeenNthCalledWith(2, nextSenderId, longReply, htmlOptions);
    });

    it('transcript with HTML-special characters is escaped in the quote', async () => {
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u8' } }))
            .mockResolvedValueOnce(flush({ data: { text: '<b>&</b>' } }))
            .mockResolvedValueOnce(flush({ data: { content: 'ок' } }));

        await emitAndSettle(voiceMessage());

        expect(bot.sendMessage).toHaveBeenCalledWith(
            nextSenderId,
            '<blockquote>🎤 &lt;b&gt;&amp;&lt;/b&gt;</blockquote>\n\nок',
            htmlOptions,
        );
    });

    it('long transcript uses an expandable quote and cuts the display at 3500 chars', async () => {
        const longTranscript = 'х'.repeat(800);
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u9' } }))
            .mockResolvedValueOnce(flush({ data: { text: longTranscript } }))
            .mockResolvedValueOnce(flush({ data: { content: 'ок' } }));

        await emitAndSettle(voiceMessage());

        const [chatId, text] = (bot.sendMessage as jest.Mock).mock.calls[0];
        expect(text.startsWith('<blockquote expandable>🎤')).toBe(true);
        // the coach got the full transcript
        expect(mockPost).toHaveBeenCalledWith('/api/bot/chat', { userId: 'u9', message: longTranscript });
    });

    it('404 from the transcribe call clears the cached userId (same self-healing as text messages)', async () => {
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u10' } }))
            .mockRejectedValueOnce(axiosError(404, {}));

        await emitAndSettle(voiceMessage());

        // The 404 cleared the cache: the next voice re-registers before transcribing.
        mockPost.mockReset();
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u10-new' } }))
            .mockResolvedValueOnce(flush({ data: { text: 'снова привет' } }))
            .mockResolvedValueOnce(flush({ data: { content: 'ок' } }));

        await emitAndSettle(voiceMessage());

        expect(mockPost).toHaveBeenCalledWith('/api/bot/user', expect.any(Object));
        expect(mockPost).toHaveBeenCalledWith('/api/bot/voice/transcribe', expect.objectContaining({ userId: 'u10-new' }));
    });

    it('F4: the voice outer catch logs the axios status/responseData of the failure', async () => {
        mockPost
            .mockResolvedValueOnce(flush({ data: { id: 'u11' } }))
            .mockRejectedValueOnce(axiosError(404, { error: { code: 'USER_NOT_FOUND' } }));

        await emitAndSettle(voiceMessage());

        const { log } = jest.requireMock('../logger') as { log: { error: jest.Mock } };
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({
                err: expect.anything(),
                status: 404,
                responseData: { error: { code: 'USER_NOT_FOUND' } },
            }),
            'voice message processing failed',
        );
    });
});
