import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import 'dotenv/config';

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: true });

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userText = msg.text;

    if (userText === '/start') {
        await bot.sendMessage(chatId, `👋 Welcome to *Fit Coach*!\n\nI'm here to help you build your fitness journey step-by-step.\n\nLet's begin! 💪`, { parse_mode: 'Markdown' });
        return;
    }

    if (!userText) return;

    try {
        const res = await axios.post(`${process.env.SERVER_URL}/api/message`, {
            userId: msg.from?.id,
            text: userText,
        });

        await bot.sendMessage(chatId, res.data.reply || 'Something went wrong 😅');
    } catch (e) {
        console.error('Bot error:', e);
        await bot.sendMessage(chatId, 'Oops! Something went wrong while talking to your coach. Please try again in a moment 🧘');
    }
});