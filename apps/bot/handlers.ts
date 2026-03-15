import type TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { log } from './logger';

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

async function registerOrGetUser(msg: TelegramBot.Message) {
    if (!msg.from) {
        throw new Error('Cannot determine user information');
    }

    const userResponse = await api.post('/api/user', {
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

    return { id: userId, firstName: msg.from.first_name, username: msg.from.username };
}

export function registerBotHandlers(bot: TelegramBot) {
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userText = msg.text;
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

        if (userText === '/start') {
            try {
                await bot.sendChatAction(chatId, 'typing');

                // Register user and get LLM greeting
                const user = await registerOrGetUser(msg);

                // Send initial message to get personalized greeting from LLM
                const chatResponse = await api.post('/api/chat', {
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
            } catch (error) {
                log.error({ 
                    err: error,
                    username: msg.from?.username,
                    ...(axios.isAxiosError(error) && {
                        status: error.response?.status,
                        responseData: error.response?.data,
                    }),
                }, '/start command failed');
                await bot.sendMessage(chatId, 'Sorry, there was an error. Please try again in a minute.');
            }
            return;
        }

        if (!userText) return;

        try {
            await bot.sendChatAction(chatId, 'typing');

            // Ensure user exists to get userId
            const user = await registerOrGetUser(msg);

            // Send message to LLM chat API
            const chatResponse = await api.post('/api/chat', {
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
        } catch (error) {
            log.error({ 
                err: error,
                username: msg.from?.username,
                ...(axios.isAxiosError(error) && {
                    status: error.response?.status,
                    responseData: error.response?.data,
                }),
            }, 'message processing failed');
            await bot.sendMessage(chatId, 'Sorry, there was an error while communicating with the coach. Please try again in a minute.');
        }
    });
}