import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';
import { registerBotHandlers } from './handlers';
import { log } from './logger';
import { createPollingWatchdog } from './watchdog';

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: true });

registerBotHandlers(bot);

// AC-1353, BUG-012: node-telegram-bot-api's polling loop can die on
// persistent Telegram errors without exiting the process — Docker's restart
// policy never fires and the bot silently stops consuming updates. This is
// the only place `process.exit` appears in the bot.
const watchdog = createPollingWatchdog({
    windowMs: 2 * 60 * 1000,
    threshold: 10,
    now: () => new Date(),
    onFatal: (reason) => {
        log.fatal({ reason }, 'Polling watchdog tripped — exiting so Docker can restart the bot');
        process.exit(1);
    },
});

bot.on('polling_error', (err) => {
    log.error({ err }, 'Telegram polling error');
    watchdog.record(err);
});

// node-telegram-bot-api exposes no "poll succeeded" event (verified in
// telegramPolling.js — only polling_error on failure and per-update-type
// events when an update actually arrives), so a delivered message is used as
// the proof-of-life signal: receiving one is only possible if the poll loop
// is running, so it resets the watchdog's consecutive-error count.
bot.on('message', () => {
    watchdog.recordSuccess();
});