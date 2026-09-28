/**
 * `runWithCleanup` (AC-SM-2 — the readable, cleanly-exiting L3/L0/L1 runner):
 * the wrapper that decides whether the embedding pipeline and the DB pool get
 * cleaned up on the way out of `evals/run.ts`, tested entirely with fakes —
 * no live embedding pipeline, no real Postgres pool, and (this file living
 * outside `evals/run.ts`) no accidental real CLI run either (see the module
 * comment on `../run-cleanup.ts` — importing this WAS `evals/run.ts` itself
 * before this move, so every `npm run test:unit` executed a full, real L0
 * eval as a side effect of the import).
 *
 * Bugs this pins:
 * - `dbPoolMayBeOpen` used to be set only after `runL3` returned its `'ran'`
 *   outcome, so a throw from INSIDE `runL3` (after its own lazy
 *   `run-scenario` import had already opened the pool) left the old
 *   `exitAfterCleanup` believing no pool existed — the pool was never closed.
 * - A rejecting `pool.end()` propagated out of the old `exitAfterCleanup`,
 *   which made the top-level `.catch()` call it a SECOND time — pg rejects a
 *   second `pool.end()` with "Called end on pool more than once".
 * - A rejecting `disposeEmbeddings()` would throw out of the `finally` block
 *   entirely, skipping the `closePool()` call written right after it and
 *   losing whatever exit code `operation` had already resolved to.
 */
import { runWithCleanup, type CleanupDeps } from '../run-cleanup';

describe('runWithCleanup (AC-SM-2)', () => {
  it('(a) operation throws mid-run after marking the pool open — pool is closed once, exit code is non-zero', async () => {
    let disposeCalls = 0;
    let closePoolCalls = 0;
    const deps: CleanupDeps = {
      disposeEmbeddings: async () => {
        disposeCalls += 1;
      },
      closePool: async () => {
        closePoolCalls += 1;
      },
    };

    const code = await runWithCleanup(async markPoolMayBeOpen => {
      markPoolMayBeOpen(); // the lazy DB import already happened, as it would inside runL3
      throw new Error('boom mid-scenario');
    }, deps);

    expect(code).not.toBe(0);
    expect(closePoolCalls).toBe(1);
    expect(disposeCalls).toBe(1);
  });

  it('(b) a rejecting pool.end() is not retried — cleanup runs once, exit code is non-zero', async () => {
    let closePoolCalls = 0;
    const deps: CleanupDeps = {
      disposeEmbeddings: async () => {},
      closePool: async () => {
        closePoolCalls += 1;
        throw new Error('Called end on pool more than once');
      },
    };

    const code = await runWithCleanup(async markPoolMayBeOpen => {
      markPoolMayBeOpen();
      return 1;
    }, deps);

    expect(code).not.toBe(0);
    expect(closePoolCalls).toBe(1);
  });

  it('(c) an operation that never opens a pool never closes one', async () => {
    let disposeCalls = 0;
    let closePoolCalls = 0;
    const deps: CleanupDeps = {
      disposeEmbeddings: async () => {
        disposeCalls += 1;
      },
      closePool: async () => {
        closePoolCalls += 1;
      },
    };

    const code = await runWithCleanup(async () => 0, deps);

    expect(code).toBe(0);
    expect(closePoolCalls).toBe(0);
    expect(disposeCalls).toBe(1);
  });

  it('(d) a rejecting disposeEmbeddings() still reaches closePool(), and the function resolves with a non-zero code', async () => {
    let closePoolCalls = 0;
    const deps: CleanupDeps = {
      disposeEmbeddings: async () => {
        throw new Error('native session teardown failed');
      },
      closePool: async () => {
        closePoolCalls += 1;
      },
    };

    const code = await runWithCleanup(async markPoolMayBeOpen => {
      markPoolMayBeOpen();
      return 0; // operation itself succeeded — the dispose failure must still surface
    }, deps);

    expect(code).not.toBe(0);
    expect(closePoolCalls).toBe(1);
  });

  it("propagates a successful operation's exit code untouched", async () => {
    let closePoolCalls = 0;
    const deps: CleanupDeps = {
      disposeEmbeddings: async () => {},
      closePool: async () => {
        closePoolCalls += 1;
      },
    };

    const code = await runWithCleanup(async markPoolMayBeOpen => {
      markPoolMayBeOpen();
      return 3;
    }, deps);

    expect(code).toBe(3);
    expect(closePoolCalls).toBe(1);
  });
});
