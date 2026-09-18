/**
 * Per-chat sequential queue (D-G, master plan item 3). `enqueue(chatId, fn)`
 * chains calls sharing the same `chatId` so they run strictly sequentially;
 * calls for different chatIds run concurrently. Client-side politeness only
 * — the correctness guarantee is the server's per-userId mutex
 * (`apps/server/src/infra/conversation/keyed-mutex.ts`, D-12); this queue
 * merely stops the bot from firing a second HTTP request that would just eat
 * the mutex's wait window.
 *
 * Deliberately not imported from the server's `keyed-mutex.ts` — same
 * package-boundary reason as `error-text.ts` (D-F): `apps/bot` has no path
 * alias into the server. This version is simpler than the mutex: no wait
 * window, no rejection — a chat simply queues behind whatever is already
 * running for it.
 *
 * The map entry for a chatId is deleted once its chain drains, so it does not
 * grow without bound.
 */

export interface ChatQueue {
    enqueue<T>(chatId: number, fn: () => Promise<T>): Promise<T>;
}

export function createChatQueue(): ChatQueue {
    const chains = new Map<number, Promise<unknown>>();

    function enqueue<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
        const previous = chains.get(chatId) ?? Promise.resolve();
        // A rejecting predecessor still lets the next enqueue run.
        const started = previous.then(
            () => undefined,
            () => undefined,
        );

        const turn = started.then(fn);

        // Swallow rejection in the chain itself so a failing fn cannot wedge
        // the next enqueue for this chatId or raise an unhandled rejection.
        const chained = turn.then(
            () => undefined,
            () => undefined,
        );
        chains.set(chatId, chained);

        const result = turn.finally(() => {
            if (chains.get(chatId) === chained) {
                chains.delete(chatId);
            }
        });

        result.catch(() => {});

        return result;
    }

    return { enqueue };
}
