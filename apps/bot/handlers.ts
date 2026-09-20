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

// D-H: userId cache per chatId, in memory, no TTL. Populated on /start (and
// kept fresh by every registerOrGetUser call); cleared on a chat 404 so the
// next message re-upserts through the server instead of retrying against a
// stale id (self-healing — the master plan's own wording).
const userIdByChatId = new Map<number, string>();

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

    const chatId = msg.chat.id;
    const cached = userIdByChatId.get(chatId);
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

    userIdByChatId.set(chatId, userId);
    return { id: userId, firstName: msg.from.first_name, username: msg.from.username };
}

export function registerBotHandlers(bot: TelegramBot) {
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;

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
                        userIdByChatId.delete(chatId);
                    }
                    log.error({ err: error }, '/clear_context failed');
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
                        userIdByChatId.delete(chatId);
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
                    userIdByChatId.delete(chatId);
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