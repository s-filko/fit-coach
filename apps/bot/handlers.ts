import type TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

async function registerOrGetUser(msg: TelegramBot.Message) {
    if (!msg.from) {
        throw new Error('Cannot determine user information');
    }

    const userResponse = await axios.post(`${process.env.SERVER_URL}/api/user`, {
        provider: 'telegram',
        providerUserId: String(msg.from.id),
        username: msg.from.username || null,
        firstName: msg.from.first_name || null,
        lastName: msg.from.last_name || null,
        languageCode: msg.from.language_code || null,
    });

    if (!userResponse.data?.user?.id) {
        throw new Error('Invalid response from server');
    }

    return userResponse.data.user;
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

            // Send message to AI
            const messageResponse = await axios.post(`${process.env.SERVER_URL}/api/message`, {
                provider: 'telegram',
                providerUserId: String(msg.from.id),
                content: userText,
            });

            if (!messageResponse.data || !messageResponse.data.response) {
                console.error('Invalid AI response:', messageResponse.data);
                throw new Error('Invalid response from AI service');
            }

            await bot.sendMessage(chatId, messageResponse.data.response);
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