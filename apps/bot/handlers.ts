import type TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

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
        console.log('Message', msg.from?.username, userText);

        if (!msg.from) {
            await bot.sendMessage(
                chatId,
                'Sorry, I cannot determine user information. Please try again.'
            );
            return;
        }

        if (userText === '/start') {
            try {
                const user = await registerOrGetUser(msg);
                const displayName = user.firstName || user.username || 'there';

                await bot.sendMessage(
                    chatId,
                    `👋 Hi ${displayName}! I'm your personal fitness coach.\n\n` +
                    `I'll help you achieve your fitness goals. Just tell me about yourself and your goals! 💪`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Error registering user:', error);
                if (axios.isAxiosError(error)) {
                    console.error('Axios error details:', {
                        status: error.response?.status,
                        data: error.response?.data,
                        headers: error.response?.headers
                    });
                }
                await bot.sendMessage(
                    chatId,
                    'Sorry, there was an error during registration. Please try again in a minute.'
                );
            }
            return;
        }

        if (!userText) return;

        try {
            await bot.sendChatAction(chatId, 'typing');

            // Ensure user exists to get userId
            const user = await registerOrGetUser(msg);

            // Send message to API (stub echo)
            const messageResponse = await api.post('/api/message', {
                userId: user.id,
                message: userText,
            });

            const echo = messageResponse.data?.data?.echo;
            if (typeof echo !== 'string') {
                console.error('Invalid API response:', messageResponse.data);
                throw new Error('Invalid response from API service');
            }

            await bot.sendMessage(chatId, echo);
        } catch (error) {
            console.error('Bot error:', error);
            if (axios.isAxiosError(error)) {
                console.error('Axios error details:', {
                    status: error.response?.status,
                    data: error.response?.data,
                    headers: error.response?.headers
                });
            }
            await bot.sendMessage(
                chatId,
                'Sorry, there was an error while communicating with the coach. Please try again in a minute.'
            );
        }
    });
}