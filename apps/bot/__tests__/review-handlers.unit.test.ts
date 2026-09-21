/**
 * Bot identity and stale-user recovery (AC-RRP-4, bot half of AC-RRP-5) — promoted from
 * review-handlers.repro.test.ts.
 *
 * The REAL `registerBotHandlers` runs against a fake Telegram emitter; only the external IO is
 * mocked: axios (the server transport) and the bot's sendMessage / sendChatAction.
 * `axios.isAxiosError` and `AxiosError` stay real.
 *
 * AC-RRP-4: the bot serves PRIVATE chats only (owner decision 2026-09-21). In any other chat it
 * makes no API call at all and answers once per chat, so one sender's words can never be sent
 * under another sender's internal userId. The identity cache is keyed by the sender, not the chat.
 * Controls: private chats stay valid, and a real-shaped 404 clears the cache so the next message
 * re-upserts (no auto-retry of the failed message).
 */
import { EventEmitter } from 'events';

import { AxiosError, type AxiosResponse } from 'axios';
import type TelegramBot from 'node-telegram-bot-api';

// jest.mock factories may only reference variables prefixed with `mock`.
const mockPost = jest.fn();

jest.mock('axios', () => {
    const actual = jest.requireActual('axios');
    const real = actual.default ?? actual;
    // Real axios (isAxiosError, AxiosError) with only `create` replaced: the module-level
    // `api = axios.create(...)` in handlers.ts becomes the recording transport.
    const patched = Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
        create: () => ({ post: mockPost }),
    });
    return { __esModule: true, ...actual, default: patched };
});

jest.mock('../logger', () => ({
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn() },
}));

interface ChatCall {
    userId: string;
    message: string;
}

interface Harness {
    bot: EventEmitter & { sendMessage: jest.Mock; sendChatAction: jest.Mock };
    deliver(msg: TelegramBot.Message): Promise<void>;
    userUpserts: string[];
    chatCalls: ChatCall[];
}

let userSeq = 0;

/** Fresh module state per test: handlers.ts keeps its userId cache at module level. */
function setup(overrides: { chat?: (body: ChatCall) => unknown } = {}): Harness {
    mockPost.mockReset();
    userSeq = 0;
    const userUpserts: string[] = [];
    const chatCalls: ChatCall[] = [];

    mockPost.mockImplementation(async (url: string, body: Record<string, string>) => {
        if (url === '/api/bot/user') {
            userUpserts.push(body.providerUserId);
            // Deterministic internal id per (provider user, upsert count) — distinguishable in assertions.
            userSeq += 1;
            return { data: { data: { id: `internal-${body.providerUserId}-${userSeq}` } } };
        }
        if (url === '/api/bot/chat') {
            chatCalls.push({ userId: body.userId, message: body.message });
            return overrides.chat?.({ userId: body.userId, message: body.message }) ?? { data: { data: { content: 'ok' } } };
        }
        throw new Error(`unexpected request ${url}`);
    });

    const bot = Object.assign(new EventEmitter(), {
        sendMessage: jest.fn().mockResolvedValue({}),
        sendChatAction: jest.fn().mockResolvedValue(true),
    });

    let registerBotHandlers!: (b: TelegramBot) => void;
    jest.isolateModules(() => {
        registerBotHandlers = require('../handlers').registerBotHandlers;
    });
    registerBotHandlers(bot as unknown as TelegramBot);

    return {
        bot,
        // EventEmitter drops the handler's promise; await every registered listener ourselves.
        deliver: async (msg) => {
            await Promise.all(bot.listeners('message').map((l) => (l as (m: TelegramBot.Message) => Promise<void>)(msg)));
        },
        userUpserts,
        chatCalls,
    };
}

function message(opts: { chatId: number; type: 'private' | 'group'; fromId: number; text: string }): TelegramBot.Message {
    return {
        message_id: 1,
        date: 0,
        chat: { id: opts.chatId, type: opts.type },
        from: { id: opts.fromId, is_bot: false, first_name: `user${opts.fromId}`, username: `u${opts.fromId}` },
        text: opts.text,
    } as TelegramBot.Message;
}

function notFound(): AxiosError {
    const response = { status: 404, statusText: 'Not Found', data: { error: { code: 'USER_NOT_FOUND' } }, headers: {}, config: {} } as AxiosResponse;
    return new AxiosError('Request failed with status code 404', 'ERR_BAD_REQUEST', undefined, undefined, response);
}

describe('bot identity and stale-user recovery (AC-RRP-4, AC-RRP-5 bot half)', () => {
    describe('AC-RRP-4 — non-private chats are refused, quietly', () => {
        it('two senders in one group: no API call at all, exactly one notice for the chat', async () => {
            const h = setup();

            await h.deliver(message({ chatId: -100, type: 'group', fromId: 111, text: 'from A' }));
            await h.deliver(message({ chatId: -100, type: 'group', fromId: 222, text: 'from B' }));
            await h.deliver(message({ chatId: -100, type: 'group', fromId: 111, text: '/start' }));

            expect(mockPost).not.toHaveBeenCalled();
            expect(h.userUpserts).toEqual([]);
            expect(h.chatCalls).toEqual([]);
            expect(h.bot.sendMessage).toHaveBeenCalledTimes(1);
            expect(h.bot.sendMessage).toHaveBeenCalledWith(-100, expect.stringContaining('private chat'));
            expect(h.bot.sendChatAction).not.toHaveBeenCalled();
        });

        it('every non-private chat type is refused, each chat gets its own single notice, in the sender language', async () => {
            const h = setup();
            const send = (chatId: number, type: string, lang?: string) =>
                h.deliver({
                    ...message({ chatId, type: 'group', fromId: 1, text: 'hello' }),
                    chat: { id: chatId, type },
                    from: { id: 1, is_bot: false, first_name: 'x', language_code: lang },
                } as TelegramBot.Message);

            await send(-1, 'group');
            await send(-2, 'supergroup', 'ru');
            await send(-3, 'channel');
            await send(-1, 'group');
            await send(-2, 'supergroup', 'ru');

            expect(mockPost).not.toHaveBeenCalled();
            expect(h.bot.sendMessage.mock.calls.map((c) => c[0])).toEqual([-1, -2, -3]);
            expect(h.bot.sendMessage.mock.calls[1][1]).toContain('личном чате');
        });

        it('a refused group does not disturb the private chat of the same person', async () => {
            const h = setup();

            await h.deliver(message({ chatId: -100, type: 'group', fromId: 111, text: 'in group' }));
            await h.deliver(message({ chatId: 111, type: 'private', fromId: 111, text: 'in private' }));

            expect(h.chatCalls).toEqual([{ userId: 'internal-111-1', message: 'in private' }]);
        });
    });

    describe('controls', () => {
        it('private chat: sender is registered once and every chat request carries its own id', async () => {
            const h = setup();

            await h.deliver(message({ chatId: 500, type: 'private', fromId: 111, text: 'one' }));
            await h.deliver(message({ chatId: 500, type: 'private', fromId: 111, text: 'two' }));

            expect(h.userUpserts).toEqual(['111']);
            expect(h.chatCalls.map((c) => c.userId)).toEqual(['internal-111-1', 'internal-111-1']);
            expect(h.bot.sendMessage).toHaveBeenCalledTimes(2);
        });

        it('two different private chats keep two different identities', async () => {
            const h = setup();

            await h.deliver(message({ chatId: 500, type: 'private', fromId: 111, text: 'from A' }));
            await h.deliver(message({ chatId: 600, type: 'private', fromId: 222, text: 'from B' }));

            expect(h.chatCalls.map((c) => c.userId)).toEqual(['internal-111-1', 'internal-222-2']);
        });

        it('the identity cache follows the SENDER, not the chat id', async () => {
            const h = setup();

            // Same sender id arriving under two different chat ids (private chats coincide with the
            // sender in production; this pins that the key is the sender, not that coincidence).
            await h.deliver(message({ chatId: 500, type: 'private', fromId: 111, text: 'one' }));
            await h.deliver(message({ chatId: 501, type: 'private', fromId: 111, text: 'two' }));

            expect(h.userUpserts).toEqual(['111']);
            expect(h.chatCalls.map((c) => c.userId)).toEqual(['internal-111-1', 'internal-111-1']);
        });

        it('a real-shaped chat 404 clears the cache; the next message re-upserts; the failed message is not retried', async () => {
            let fail = true;
            const h = setup({
                chat: () => {
                    if (fail) {
                        fail = false;
                        throw notFound();
                    }
                    return undefined;
                },
            });

            await h.deliver(message({ chatId: 500, type: 'private', fromId: 111, text: 'first' }));
            // The first chat request hit the 404: user was upserted once, no second attempt was made.
            expect(h.userUpserts).toEqual(['111']);
            expect(h.chatCalls).toEqual([{ userId: 'internal-111-1', message: 'first' }]);
            expect(h.bot.sendMessage).toHaveBeenCalledTimes(1); // the error text — the typed one, not the generic fallback
            expect(h.bot.sendMessage).toHaveBeenCalledWith(500, expect.stringContaining('send your message again'));

            await h.deliver(message({ chatId: 500, type: 'private', fromId: 111, text: 'second' }));

            expect(h.userUpserts).toEqual(['111', '111']);
            expect(h.chatCalls[1]).toEqual({ userId: 'internal-111-2', message: 'second' });
        });
    });
});
