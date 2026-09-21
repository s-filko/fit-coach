import axios from 'axios';
import { EventEmitter } from 'events';
import type TelegramBot from 'node-telegram-bot-api';

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

describe('bot /compact handler (unit)', () => {
    let bot: TelegramBot & EventEmitter;

    beforeEach(() => {
        jest.clearAllMocks();
        bot = new EventEmitter() as unknown as TelegramBot & EventEmitter;
        bot.sendMessage = jest.fn().mockResolvedValue({ message_id: 123 });
        bot.sendChatAction = jest.fn().mockResolvedValue(true);
        registerBotHandlers(bot);
    });

    it('compacts successfully and replies in Russian when languageCode is ru', async () => {
        // First call: registerOrGetUser -> POST /api/bot/user
        mockPost.mockResolvedValueOnce({ data: { data: { id: 'u1' } } });
        // Second call: POST /api/bot/chat/compact
        mockPost.mockResolvedValueOnce({ data: { data: { outcome: 'compacted' } } });

        const msg: TelegramBot.Message = {
            message_id: 1,
            date: Date.now(),
            chat: { id: 100, type: 'private' },
            from: { id: 100, is_bot: false, first_name: 'Иван', language_code: 'ru' },
            text: '/compact',
        };

        bot.emit('message', msg);
        // Wait for queue processing
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockPost).toHaveBeenCalledWith('/api/bot/user', expect.any(Object));
        expect(mockPost).toHaveBeenCalledWith('/api/bot/chat/compact', { userId: 'u1' });
        expect(bot.sendMessage).toHaveBeenCalledWith(100, 'Разговор сохранён в память.');
    });

    it('compacts successfully and replies in English when languageCode is en', async () => {
        mockPost.mockResolvedValueOnce({ data: { data: { id: 'u2' } } });
        mockPost.mockResolvedValueOnce({ data: { data: { outcome: 'compacted' } } });

        const msg: TelegramBot.Message = {
            message_id: 2,
            date: Date.now(),
            chat: { id: 200, type: 'private' },
            from: { id: 200, is_bot: false, first_name: 'John', language_code: 'en' },
            text: '/compact',
        };

        bot.emit('message', msg);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockPost).toHaveBeenCalledWith('/api/bot/chat/compact', { userId: 'u2' });
        expect(bot.sendMessage).toHaveBeenCalledWith(200, 'The conversation so far has been folded into memory.');
    });

    it('replies honestly when nothing to compact (ru and en)', async () => {
        mockPost.mockResolvedValueOnce({ data: { data: { id: 'u3' } } });
        mockPost.mockResolvedValueOnce({ data: { data: { outcome: 'nothing_to_compact' } } });

        const msgRu: TelegramBot.Message = {
            message_id: 3,
            date: Date.now(),
            chat: { id: 300, type: 'private' },
            from: { id: 300, is_bot: false, first_name: 'Иван', language_code: 'ru' },
            text: '/compact',
        };

        bot.emit('message', msgRu);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(bot.sendMessage).toHaveBeenCalledWith(300, 'Пока нечего сохранять в память.');

        mockPost.mockResolvedValueOnce({ data: { data: { id: 'u4' } } });
        mockPost.mockResolvedValueOnce({ data: { data: { outcome: 'nothing_to_compact' } } });

        const msgEn: TelegramBot.Message = {
            message_id: 4,
            date: Date.now(),
            chat: { id: 400, type: 'private' },
            from: { id: 400, is_bot: false, first_name: 'John', language_code: 'en' },
            text: '/compact',
        };

        bot.emit('message', msgEn);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(bot.sendMessage).toHaveBeenCalledWith(400, 'Nothing to fold into memory yet.');
    });

    it('handles typed error responses with errorTextFor', async () => {
        mockPost.mockResolvedValueOnce({ data: { data: { id: 'u5' } } });
        const axiosError = new axios.AxiosError('Busy', '409', undefined, undefined, {
            status: 409,
            data: { error: { code: 'THREAD_BUSY' } },
        } as never);
        mockPost.mockRejectedValueOnce(axiosError);

        const msg: TelegramBot.Message = {
            message_id: 5,
            date: Date.now(),
            chat: { id: 500, type: 'private' },
            from: { id: 500, is_bot: false, first_name: 'Иван', language_code: 'ru' },
            text: '/compact',
        };

        bot.emit('message', msg);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(bot.sendMessage).toHaveBeenCalledWith(
            500,
            expect.stringContaining('Твоё предыдущее сообщение ещё обрабатывается'),
        );
    });

    it('clears cached userId on 404', async () => {
        // First /compact call caches userId
        mockPost.mockResolvedValueOnce({ data: { data: { id: 'u6' } } });
        mockPost.mockResolvedValueOnce({ data: { data: { outcome: 'compacted' } } });

        const msg: TelegramBot.Message = {
            message_id: 6,
            date: Date.now(),
            chat: { id: 600, type: 'private' },
            from: { id: 600, is_bot: false, first_name: 'Alice', language_code: 'en' },
            text: '/compact',
        };

        bot.emit('message', msg);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(mockPost).toHaveBeenCalledTimes(2);

        // Next call returns 404 from compact
        const notFoundError = new axios.AxiosError('Not Found', '404', undefined, undefined, {
            status: 404,
            data: {},
        } as never);
        mockPost.mockRejectedValueOnce(notFoundError);

        bot.emit('message', msg);
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Third call should re-register user because 404 cleared the cache
        mockPost.mockResolvedValueOnce({ data: { data: { id: 'u6-new' } } });
        mockPost.mockResolvedValueOnce({ data: { data: { outcome: 'compacted' } } });

        bot.emit('message', msg);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockPost).toHaveBeenCalledWith('/api/bot/user', expect.any(Object));
        expect(mockPost).toHaveBeenCalledWith('/api/bot/chat/compact', { userId: 'u6-new' });
    });
});
