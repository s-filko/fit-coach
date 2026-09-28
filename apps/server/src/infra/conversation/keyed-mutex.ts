import { ThreadBusyError } from '@domain/conversation/ports';

/**
 * A per-key in-process mutex (D-12, D-A, ADR-0013 §6). `run(key, fn)` chains
 * calls sharing the same `key` so they execute strictly sequentially; calls
 * with different keys run concurrently. A waiter that does not get to start
 * within `waitMs` rejects with `ThreadBusyError` instead of joining the
 * chain, so a stuck holder cannot pile up unbounded waiters.
 *
 * This is **in-process and single-instance by stated constraint** (P5 Global
 * Constraints). The multi-instance successor is
 * `pg_advisory_xact_lock(hashtext(userId))` at the same seam
 * (`with-run-mutex.ts`, master plan item 1) — not implemented here.
 *
 * The map entry for a key is deleted once the last queued holder for that
 * key settles, so `size()` does not grow without bound.
 */
export interface KeyedMutex {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
  size(): number;
}

export interface KeyedMutexOptions {
  /** Max time a waiter may wait to *start* before rejecting with ThreadBusyError. */
  waitMs: number;
}

/** Rejects with `ThreadBusyError` after `waitMs`; the handle lets the caller cancel it. */
function createWaitTimeout(waitMs: number): { promise: Promise<never>; handle: ReturnType<typeof setTimeout> } {
  let handle!: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new ThreadBusyError()), waitMs);
  });
  return { promise, handle };
}

export function createKeyedMutex(opts: KeyedMutexOptions): KeyedMutex {
  const chains = new Map<string, Promise<unknown>>();

  function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    // A rejecting predecessor still releases the key for the next waiter.
    const started = previous.then(
      () => true,
      () => true,
    );

    // Race waiting-to-start against the wait window. Whichever settles the
    // fn's *invocation* is what matters — once fn is entered, its own
    // duration is not bounded by waitMs.
    const { promise: waitTimeout, handle: timeoutHandle } = createWaitTimeout(opts.waitMs);
    const turn = Promise.race([started, waitTimeout]).then(() => fn());

    // Swallow rejection in the chain itself so it doesn't become an
    // unhandled rejection or block the next waiter; the real result/error
    // is still delivered to the caller via `result` below.
    const chained = turn.then(
      () => undefined,
      () => undefined,
    );
    chains.set(key, chained);

    const result = turn.finally(() => {
      clearTimeout(timeoutHandle);
      if (chains.get(key) === chained) {
        chains.delete(key);
      }
    });

    // Prevent an unhandled-rejection warning on `result` if the caller
    // doesn't attach a rejection handler synchronously.
    result.catch(() => {});

    return result;
  }

  function size(): number {
    return chains.size;
  }

  return { run, size };
}
