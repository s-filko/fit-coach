/**
 * Typing keep-alive (AC-RL-3, BUG-019): one Telegram `typing` pulse lasts
 * ~5 s, and the bot used to send exactly one per incoming message — so while
 * the server spent minutes producing an answer, the chat looked dead. This
 * wrapper re-pulses for as long as the wrapped work is in flight.
 *
 * Cadence: every 5.5 s (the 5–6 s window, a named constant — never seamless:
 * the owner wants the ~1 s "person pauses to think" gap). A hard ceiling of
 * 420 s (the server's requestTimeout) guarantees a hung request cannot pulse
 * forever. A failing `sendChatAction` is logged and forgotten — the answer
 * matters, the indicator does not. No timer outlives the call: both timers
 * are cleared in a `finally`, tied to the wrapped promise settling.
 */

import type TelegramBot from 'node-telegram-bot-api';

import { log } from './logger';

/** Pulse cadence: 5–6 s window (AC-RL-3), the ~1 s gap reads as natural. */
export const TYPING_INTERVAL_MS = 5500;
/** Hard ceiling: the server's requestTimeout (420 s) — a hung request cannot pulse forever. */
export const TYPING_CEILING_MS = 420_000;

async function pulse(bot: TelegramBot, chatId: number): Promise<void> {
    try {
        await bot.sendChatAction(chatId, 'typing');
    } catch (err) {
        log.warn({ err: String(err), chatId }, 'typing action failed — ignored, the reply path is unaffected');
    }
}

/**
 * Runs `fn` while keeping the chat's typing indicator alive: one pulse
 * immediately (fire-and-forget — it must never delay the request), then one
 * per TYPING_INTERVAL_MS until `fn` settles or the ceiling hits. Resolves /
 * rejects with exactly what `fn` produces; the error path is untouched.
 */
export async function withTypingIndicator<T>(
    bot: TelegramBot,
    chatId: number,
    fn: () => Promise<T>,
): Promise<T> {
    let pulsing = true;
    void pulse(bot, chatId);
    const interval = setInterval(() => {
        if (pulsing) {
            void pulse(bot, chatId);
        }
    }, TYPING_INTERVAL_MS);
    const ceiling = setTimeout(() => {
        pulsing = false;
        clearInterval(interval);
        log.warn(
            { chatId, ceilingMs: TYPING_CEILING_MS },
            'typing keep-alive hit its ceiling — request still in flight',
        );
    }, TYPING_CEILING_MS);
    const stop = (): void => {
        pulsing = false;
        clearInterval(interval);
        clearTimeout(ceiling);
    };

    try {
        return await fn();
    } finally {
        stop();
    }
}
