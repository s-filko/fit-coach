import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';
import { registerBotHandlers } from './handlers';

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: true });

registerBotHandlers(bot);