import { createPollingWatchdog } from '../watchdog';

const WINDOW_MS = 2 * 60 * 1000;
const THRESHOLD = 10;

function makeClock(startMs = 0): { now: () => Date; advance: (ms: number) => void } {
    let current = startMs;
    return {
        now: () => new Date(current),
        advance: (ms: number) => {
            current += ms;
        },
    };
}

describe('createPollingWatchdog (AC-1353, BUG-012)', () => {
    it('AC-1353: an EFATAL error shaped { code: "EFATAL" } calls onFatal exactly once', () => {
        const onFatal = jest.fn();
        const clock = makeClock();
        const watchdog = createPollingWatchdog({ windowMs: WINDOW_MS, threshold: THRESHOLD, onFatal, now: clock.now });

        watchdog.record({ code: 'EFATAL', message: 'polling died' });

        expect(onFatal).toHaveBeenCalledTimes(1);
    });

    it('AC-1353: an EFATAL error shaped as an Error whose message starts with "EFATAL:" calls onFatal exactly once', () => {
        const onFatal = jest.fn();
        const clock = makeClock();
        const watchdog = createPollingWatchdog({ windowMs: WINDOW_MS, threshold: THRESHOLD, onFatal, now: clock.now });

        watchdog.record(new Error('EFATAL: something broke'));

        expect(onFatal).toHaveBeenCalledTimes(1);
    });

    it('AC-1353: 9 non-fatal errors inside the window do not call onFatal', () => {
        const onFatal = jest.fn();
        const clock = makeClock();
        const watchdog = createPollingWatchdog({ windowMs: WINDOW_MS, threshold: THRESHOLD, onFatal, now: clock.now });

        for (let i = 0; i < 9; i++) {
            clock.advance(1000);
            watchdog.record(new Error(`transient ${i}`));
        }

        expect(onFatal).not.toHaveBeenCalled();
    });

    it('AC-1353: the 10th non-fatal error inside the window calls onFatal', () => {
        const onFatal = jest.fn();
        const clock = makeClock();
        const watchdog = createPollingWatchdog({ windowMs: WINDOW_MS, threshold: THRESHOLD, onFatal, now: clock.now });

        for (let i = 0; i < 10; i++) {
            clock.advance(1000);
            watchdog.record(new Error(`transient ${i}`));
        }

        expect(onFatal).toHaveBeenCalledTimes(1);
    });

    it('AC-1353: 10 errors spread outside the window (never 10 within it) do not call onFatal', () => {
        const onFatal = jest.fn();
        const clock = makeClock();
        const watchdog = createPollingWatchdog({ windowMs: WINDOW_MS, threshold: THRESHOLD, onFatal, now: clock.now });

        // Space errors far enough apart that the window (2 min) never holds
        // more than a handful at once: one every 30s for 10 errors — the
        // window holds at most 4 at any instant (2 min / 30s = 4).
        for (let i = 0; i < 10; i++) {
            clock.advance(30_000);
            watchdog.record(new Error(`transient ${i}`));
        }

        expect(onFatal).not.toHaveBeenCalled();
    });

    it('AC-1353: a success between errors resets the consecutive count', () => {
        const onFatal = jest.fn();
        const clock = makeClock();
        const watchdog = createPollingWatchdog({ windowMs: WINDOW_MS, threshold: THRESHOLD, onFatal, now: clock.now });

        for (let i = 0; i < 9; i++) {
            clock.advance(1000);
            watchdog.record(new Error(`transient ${i}`));
        }
        clock.advance(1000);
        watchdog.recordSuccess();

        // Another 9 errors after the reset must still not trip the threshold.
        for (let i = 0; i < 9; i++) {
            clock.advance(1000);
            watchdog.record(new Error(`transient-after-reset ${i}`));
        }

        expect(onFatal).not.toHaveBeenCalled();
    });

    it('AC-1353: after recordSuccess(), threshold - 1 prior errors no longer contribute — the next single error does not trip', () => {
        const onFatal = jest.fn();
        const clock = makeClock();
        const watchdog = createPollingWatchdog({ windowMs: WINDOW_MS, threshold: THRESHOLD, onFatal, now: clock.now });

        // threshold - 1 = 9 errors, all still well inside the window.
        for (let i = 0; i < THRESHOLD - 1; i++) {
            clock.advance(1000);
            watchdog.record(new Error(`transient ${i}`));
        }
        clock.advance(1000);
        watchdog.recordSuccess();

        // A single error right after the reset must not trip — if the 9
        // prior timestamps had survived, this 10th record() would trip.
        clock.advance(1000);
        watchdog.record(new Error('transient after reset'));

        expect(onFatal).not.toHaveBeenCalled();
    });

    it('never sleeps and never calls the real process.exit — onFatal/now are fully injected', () => {
        const onFatal = jest.fn();
        const clock = makeClock(123456789);
        const watchdog = createPollingWatchdog({ windowMs: WINDOW_MS, threshold: THRESHOLD, onFatal, now: clock.now });

        watchdog.record({ code: 'EFATAL' });

        expect(onFatal).toHaveBeenCalledTimes(1);
        // No timers were used to reach this assertion — the test never awaited
        // or used jest fake/real timers; `now` alone drove the window logic.
    });
});
