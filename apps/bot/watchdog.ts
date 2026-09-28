/**
 * Polling watchdog (AC-1353, BUG-012, D-E): node-telegram-bot-api's polling
 * loop dies on persistent Telegram errors (502/ECONNRESET, seen 2026-08-08)
 * without exiting the process — Docker's restart policy never fires and the
 * bot silently stops consuming updates. This watchdog makes the bot die
 * loudly instead: `record(err)` is fatal immediately on an EFATAL error, or
 * when `threshold` consecutive errors land inside `windowMs`.
 *
 * `onFatal` and `now` are injected so a test never calls the real
 * `process.exit` and never sleeps to exercise the time window — the only
 * live wiring (`process.exit(1)`) lives in `index.ts`, the sole caller of
 * this module in production.
 */

export interface PollingWatchdogOptions {
    /** Sliding window (ms) — only errors inside it count toward `threshold`. */
    windowMs: number;
    /** Consecutive errors within `windowMs` that trigger onFatal (10, master plan item 3). */
    threshold: number;
    /** Called exactly once per fatal condition — never call process.exit here in a test. */
    onFatal: (reason: string) => void;
    /** Injected clock — tests drive it without real sleeps. */
    now: () => Date;
}

export interface PollingWatchdog {
    /** Feed a polling_error. Fatal immediately on EFATAL, or on threshold errors inside the window. */
    record(err: unknown): void;
    /** A successful poll — resets the consecutive-error count. */
    recordSuccess(): void;
}

/** node-telegram-bot-api is inconsistent: sometimes `{ code: 'EFATAL' }`, sometimes `Error('EFATAL: ...')`. */
function isEfatal(err: unknown): boolean {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 'EFATAL') {
        return true;
    }
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
    return message.startsWith('EFATAL');
}

export function createPollingWatchdog(opts: PollingWatchdogOptions): PollingWatchdog {
    const { windowMs, threshold, onFatal, now } = opts;
    let errorTimestamps: number[] = [];
    let fatalTripped = false;

    function record(err: unknown): void {
        if (fatalTripped) {
            return;
        }
        if (isEfatal(err)) {
            fatalTripped = true;
            onFatal('EFATAL');
            return;
        }

        const nowMs = now().getTime();
        errorTimestamps.push(nowMs);
        errorTimestamps = errorTimestamps.filter(t => nowMs - t < windowMs);

        if (errorTimestamps.length >= threshold) {
            fatalTripped = true;
            onFatal(`${errorTimestamps.length} polling errors within ${windowMs}ms`);
        }
    }

    function recordSuccess(): void {
        errorTimestamps = [];
    }

    return { record, recordSuccess };
}
