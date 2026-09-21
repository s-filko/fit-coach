import type TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { errorTextFor } from './error-text';
import { log } from './logger';
import { createChatQueue } from './queue';
import { withTypingIndicator } from './typing-keepalive';

async function sendHtml(bot: TelegramBot, chatId: number, text: string): Promise<void> {
    try {
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (htmlError) {
        const isHtmlParseError = htmlError instanceof Error && htmlError.message.includes("can't parse entities");
        if (!isHtmlParseError) {
            throw htmlError;
        }
        log.warn({ chatId, textSnippet: text.slice(0, 100) }, 'HTML parse failed, retrying as plain text');
        try {
            await bot.sendMessage(chatId, text);
        } catch (fallbackError) {
            log.error(
                { chatId, htmlError, fallbackError },
                'Plain text fallback also failed after HTML parse error',
            );
            throw fallbackError;
        }
    }
}

const api = axios.create({
    baseURL: process.env.SERVER_URL,
    headers: {
        'X-Api-Key': process.env.BOT_API_KEY || ''
    }
});

// D-H: internal userId cache per SENDER (Telegram `from.id`), in memory, no TTL. Populated on
// /start (and kept fresh by every registerOrGetUser call); cleared on a chat 404 so the next
// message re-upserts through the server instead of retrying against a stale id (self-healing —
// the master plan's own wording). Keyed by the sender, never the chat: an identity must follow
// the person who wrote the message, and a chat-keyed cache is only right while a chat has exactly
// one sender (AC-RRP-4).
const userIdBySenderId = new Map<number, string>();

// The bot serves private chats only (owner decision 2026-09-21): a personal coach whose memory
// and training data belong to one person. In any other chat it makes no API call and answers
// once per chat, so a busy group is not spammed. Bounded so a bot added to many groups cannot
// grow the set without limit; the oldest entry is forgotten first (worst case: one extra notice).
const NON_PRIVATE_NOTICE_LIMIT = 1000;
const noticedNonPrivateChats = new Set<number>();

function nonPrivateChatNotice(languageCode: string | undefined): string {
    return languageCode === 'ru'
        ? 'Я работаю только в личном чате — напиши мне в личные сообщения.'
        : 'I only work in a private chat — please message me directly.';
}

async function refuseNonPrivateChat(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    if (noticedNonPrivateChats.has(chatId)) {
        return;
    }
    noticedNonPrivateChats.add(chatId);
    if (noticedNonPrivateChats.size > NON_PRIVATE_NOTICE_LIMIT) {
        const oldest = noticedNonPrivateChats.values().next().value;
        if (oldest !== undefined) {
            noticedNonPrivateChats.delete(oldest);
        }
    }
    log.info({ chatId, chatType: msg.chat.type }, 'non-private chat — answering once that only private chats are served');
    try {
        await bot.sendMessage(chatId, nonPrivateChatNotice(msg.from?.language_code));
    } catch (err) {
        log.warn({ err: String(err), chatId }, 'could not send the private-chat-only notice');
    }
}

const chatQueue = createChatQueue();

/** True for an axios error whose response status is 404 (a stale cached userId). */
function isNotFound(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 404;
}

/** The server's ConversationErrorCode (ADR-0013 §6), when the error is a typed axios response. */
function conversationErrorCodeOf(error: unknown): string | undefined {
    if (!axios.isAxiosError(error)) {
        return undefined;
    }
    const code = error.response?.data?.error?.code;
    return typeof code === 'string' ? code : undefined;
}

async function registerOrGetUser(msg: TelegramBot.Message) {
    if (!msg.from) {
        throw new Error('Cannot determine user information');
    }

    const cached = userIdBySenderId.get(msg.from.id);
    if (cached) {
        return { id: cached, firstName: msg.from.first_name, username: msg.from.username };
    }

    const userResponse = await api.post('/api/bot/user', {
        provider: 'telegram',
        providerUserId: String(msg.from.id),
        username: msg.from.username || undefined,
        firstName: msg.from.first_name || undefined,
        lastName: msg.from.last_name || undefined,
        languageCode: msg.from.language_code || undefined,
    });

    const userId = userResponse.data?.data?.id;
    if (!userId) {
        throw new Error('Invalid response from server: missing data.id');
    }

    userIdBySenderId.set(msg.from.id, userId);
    return { id: userId, firstName: msg.from.first_name, username: msg.from.username };
}

export function registerBotHandlers(bot: TelegramBot) {
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;

        // Private chats only: no API call, no identity lookup, no queue for anything else.
        if (msg.chat.type !== 'private') {
            await refuseNonPrivateChat(bot, msg);
            return;
        }

        // D-G: serialise everything for one chatId so the bot never fires a
        // second HTTP request while the first is still in flight (client-side
        // politeness — the server's per-userId mutex is the real guarantee).
        await chatQueue.enqueue(chatId, async () => {
            const userText = msg.text;
            const languageCode = msg.from?.language_code;
            log.info({
                username: msg.from?.username,
                chatId,
                textLength: userText?.length,
                command: userText?.startsWith('/') ? userText.split(' ')[0] : undefined,
            }, 'incoming message');

            if (!msg.from) {
                await bot.sendMessage(
                    chatId,
                    'Sorry, I cannot determine user information. Please try again.'
                );
                return;
            }

            if (userText === '/clear_context') {
                try {
                    await withTypingIndicator(bot, chatId, async () => {
                        const user = await registerOrGetUser(msg);
                        await api.post('/api/bot/chat/clear-context', { userId: user.id });
                    });
                    await bot.sendMessage(chatId, '🧹 Context cleared. Starting fresh!');
                } catch (error) {
                    if (isNotFound(error)) {
                        userIdBySenderId.delete(msg.from.id);
                    }
                    log.error({ err: error }, '/clear_context failed');
                    await bot.sendMessage(chatId, errorTextFor(conversationErrorCodeOf(error), languageCode));
                }
                return;
            }

            if (userText === '/compact') {
                try {
                    const outcome = await withTypingIndicator(bot, chatId, async () => {
                        const user = await registerOrGetUser(msg);
                        const res = await api.post('/api/bot/chat/compact', { userId: user.id });
                        return (res.data?.data?.outcome as 'compacted' | 'nothing_to_compact' | undefined) ?? 'nothing_to_compact';
                    });
                    const isRu = languageCode === 'ru';
                    const reply = outcome === 'compacted'
                        ? (isRu ? 'Разговор сохранён в память.' : 'The conversation so far has been folded into memory.')
                        : (isRu ? 'Пока нечего сохранять в память.' : 'Nothing to fold into memory yet.');
                    await bot.sendMessage(chatId, reply);
                } catch (error) {
                    if (isNotFound(error)) {
                        userIdBySenderId.delete(msg.from.id);
                    }
                    log.error({ err: error }, '/compact failed');
                    await bot.sendMessage(chatId, errorTextFor(conversationErrorCodeOf(error), languageCode));
                }
                return;
            }

            if (userText === '/start') {
                try {
                    await withTypingIndicator(bot, chatId, async () => {
                        // Register user and get LLM greeting
                        const user = await registerOrGetUser(msg);

                        // Send initial message to get personalized greeting from LLM
                        const chatResponse = await api.post('/api/bot/chat', {
                            userId: user.id,
                            message: 'hi',
                        });

                        const aiResponse = chatResponse.data?.data?.content;
                        if (typeof aiResponse !== 'string') {
                            log.error({ responseData: chatResponse.data }, 'invalid AI response on /start');
                            throw new Error('Invalid response from AI service');
                        }

                        if (!aiResponse.trim()) {
                            log.warn({ chatId, username: msg.from?.username }, 'LLM returned empty response on /start, suppressing');
                            return;
                        }

                        await sendHtml(bot, chatId, aiResponse);
                    });
                } catch (error) {
                    if (isNotFound(error)) {
                        userIdBySenderId.delete(msg.from.id);
                    }
                    log.error({
                        err: error,
                        username: msg.from?.username,
                        ...(axios.isAxiosError(error) && {
                            status: error.response?.status,
                            responseData: error.response?.data,
                        }),
                    }, '/start command failed');
                    await bot.sendMessage(chatId, errorTextFor(conversationErrorCodeOf(error), languageCode));
                }
                return;
            }

            if (!userText) return;

            try {
                await withTypingIndicator(bot, chatId, async () => {
                    // Ensure user exists to get userId
                    const user = await registerOrGetUser(msg);

                    // Send message to LLM chat API
                    const chatResponse = await api.post('/api/bot/chat', {
                        userId: user.id,
                        message: userText,
                    });

                    const aiResponse = chatResponse.data?.data?.content;
                    if (typeof aiResponse !== 'string') {
                        log.error({ responseData: chatResponse.data }, 'invalid AI response');
                        throw new Error('Invalid response from AI service');
                    }

                    if (!aiResponse.trim()) {
                        log.warn({ chatId, username: msg.from?.username, userText }, 'LLM returned empty response, suppressing');
                        return;
                    }

                    await sendHtml(bot, chatId, aiResponse);
                });
            } catch (error) {
                if (isNotFound(error)) {
                    userIdBySenderId.delete(msg.from.id);
                }
                log.error({
                    err: error,
                    username: msg.from?.username,
                    ...(axios.isAxiosError(error) && {
                        status: error.response?.status,
                        responseData: error.response?.data,
                    }),
                }, 'message processing failed');
                await bot.sendMessage(chatId, errorTextFor(conversationErrorCodeOf(error), languageCode));
            }
        });
    });
}