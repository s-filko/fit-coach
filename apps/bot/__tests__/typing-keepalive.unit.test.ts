import type TelegramBot from 'node-telegram-bot-api';

import { TYPING_CEILING_MS, TYPING_INTERVAL_MS, withTypingIndicator } from '../typing-keepalive';

jest.mock('../logger', () => ({
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
const { log } = jest.requireMock('../logger') as { log: { warn: jest.Mock; info: jest.Mock } };

function makeBot(): { bot: TelegramBot; sendChatAction: jest.Mock } {
    const sendChatAction = jest.fn(async () => true);
    return { bot: { sendChatAction } as unknown as TelegramBot, sendChatAction };
}

/** A promise the test settles manually — the "request in flight". */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('withTypingIndicator (AC-RL-3, BUG-019)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it('pulses immediately, then every 5.5 s while the work is in flight; nothing outlives the call', async () => {
        const { bot, sendChatAction } = makeBot();
        const d = deferred<string>();
        const wrapped = withTypingIndicator(bot, 1, () => d.promise);

        // One pulse at t=0 (sent before the request starts), then one per interval.
        expect(sendChatAction).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(2); // the interval + the ceiling

        jest.advanceTimersByTime(TYPING_INTERVAL_MS);
        expect(sendChatAction).toHaveBeenCalledTimes(2);
        jest.advanceTimersByTime(TYPING_INTERVAL_MS);
        expect(sendChatAction).toHaveBeenCalledTimes(3);

        // 5.5 s cadence: +4999 ms must NOT fire another pulse (owner: the ~1 s
        // gap reads as "a person pauses to think" — never make it seamless).
        jest.advanceTimersByTime(TYPING_INTERVAL_MS - 501);
        expect(sendChatAction).toHaveBeenCalledTimes(3);

        d.resolve('answer');
        await expect(wrapped).resolves.toBe('answer');
        expect(jest.getTimerCount()).toBe(0);
        jest.advanceTimersByTime(60_000);
        expect(sendChatAction).toHaveBeenCalledTimes(3);
    });

    it('rejects with the same error (no swallowing) and leaves no timers', async () => {
        const { bot, sendChatAction } = makeBot();
        const d = deferred<string>();
        const wrapped = withTypingIndicator(bot, 1, () => d.promise);

        d.reject(new Error('server 500'));
        await expect(wrapped).rejects.toThrow('server 500');
        expect(jest.getTimerCount()).toBe(0);
        expect(sendChatAction).toHaveBeenCalledTimes(1);
    });

    it('stops at the 420 s ceiling even if the request never settles', async () => {
        const { bot, sendChatAction } = makeBot();
        const d = deferred<void>();
        const wrapped = withTypingIndicator(bot, 1, () => d.promise);

        jest.advanceTimersByTime(TYPING_CEILING_MS);
        // initial pulse + one per interval tick inside the ceiling window
        const pulsesAtCeiling = 1 + Math.floor(TYPING_CEILING_MS / TYPING_INTERVAL_MS);
        expect(sendChatAction).toHaveBeenCalledTimes(pulsesAtCeiling);
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ chatId: 1 }),
            expect.stringContaining('ceiling'),
        );
        expect(jest.getTimerCount()).toBe(0); // the ceiling consumed itself, the interval is cleared

        // A hung request cannot pulse forever: a whole second ceiling passes with zero new pulses.
        jest.advanceTimersByTime(TYPING_CEILING_MS);
        expect(sendChatAction).toHaveBeenCalledTimes(pulsesAtCeiling);

        d.resolve();
        await wrapped;
        expect(jest.getTimerCount()).toBe(0);
    });

    it('a failing first pulse is logged and never breaks or delays the reply', async () => {
        const { bot, sendChatAction } = makeBot();
        sendChatAction.mockRejectedValue(new Error('ETELEGRAM 400'));

        const result = await withTypingIndicator(bot, 1, async () => 'answer');

        expect(result).toBe('answer');
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ chatId: 1 }),
            expect.stringContaining('typing'),
        );
    });

    it('a failing interval pulse stops nothing — later pulses fire and the reply arrives', async () => {
        const { bot, sendChatAction } = makeBot();
        sendChatAction
            .mockResolvedValueOnce(true)
            .mockRejectedValueOnce(new Error('ETELEGRAM 429'))
            .mockResolvedValue(true);
        const d = deferred<string>();
        const wrapped = withTypingIndicator(bot, 1, () => d.promise);

        jest.advanceTimersByTime(TYPING_INTERVAL_MS); // pulse 2 fails
        jest.advanceTimersByTime(TYPING_INTERVAL_MS); // pulse 3 succeeds
        expect(sendChatAction).toHaveBeenCalledTimes(3);

        d.resolve('ok');
        await expect(wrapped).resolves.toBe('ok');
        expect(jest.getTimerCount()).toBe(0);
    });

    it('a fast request sends exactly one pulse — no interval tick ever fires', async () => {
        const { bot, sendChatAction } = makeBot();

        const result = await withTypingIndicator(bot, 1, async () => 42);

        expect(result).toBe(42);
        expect(sendChatAction).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });
});
