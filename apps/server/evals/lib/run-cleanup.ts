/**
 * `runWithCleanup` — the generic teardown wrapper `evals/run.ts` funnels its
 * whole CLI run through. Split out of `run.ts` (R3 re-review, regression
 * from `6ead3d9f`): `run.ts`'s top level unconditionally runs the CLI
 * (`void runWithCleanup(main, realCleanupDeps)`), so importing `runWithCleanup`
 * FROM `run.ts` for a unit test also ran that side effect — every
 * `npm run test:unit` executed a full, real L0 eval and set `process.exitCode`
 * from inside jest. This file has no side effects at module load; only
 * `run.ts` does the actual `void runWithCleanup(main, realCleanupDeps)` call.
 */

/**
 * The two real teardown effects `runWithCleanup` performs — injectable so the
 * wrapper can be unit tested with fakes (close-out review advisory 2), never
 * touching a live embedding pipeline or a real Postgres pool.
 */
export interface CleanupDeps {
  disposeEmbeddings: () => Promise<void>;
  /** Closes the DB pool. Only called when `operation` reported one might be open. */
  closePool: () => Promise<void>;
}

/**
 * Runs `operation` and returns the exit code it resolves to (or
 * `fallbackErrorCode` if it throws), and — no matter which, including a throw
 * from ANYWHERE inside `operation`, not just its normal-completion path —
 * disposes the embedding pipeline and, if `operation` ever called the
 * `markPoolMayBeOpen` callback it's given, closes the DB pool. Both run
 * exactly once each, in a `finally`, so neither can be skipped by an early
 * `return`/`throw` inside `operation` and neither can fire twice — a
 * rejecting `closePool()` is caught right here, not left to propagate and
 * make an outer handler retry it (pg rejects a second `pool.end()` with
 * "Called end on pool more than once"). A rejecting `disposeEmbeddings()` is
 * caught the same way (R3 re-review): otherwise it would throw OUT of this
 * `finally` block, which supersedes whatever `operation` returned/threw AND
 * skips the `closePool()` call written right after it — the function must
 * still resolve (with a non-zero code) and still attempt to close the pool.
 *
 * Exit 134 (close-out review, first two live runs): a live L3 run loads the
 * shared embedding pipeline's native ONNX session (search_exercises) — a
 * throwaway repro (load it, dispose it, then `process.exit()`) reproduced
 * `libc++abi … mutex lock failed` every time. `disposeEmbeddings()`
 * resolving only means the JS-visible teardown call returned, not that the
 * native thread pool has actually unwound; `process.exit()` tears the
 * process down before it can. The caller therefore sets `process.exitCode`
 * from this function's return value and never calls `process.exit()` —
 * Node's normal, un-forced exit lets that native unwind finish on its own,
 * the same mechanism jest already relies on (`jest.config.cjs`'s
 * `forceExit: false` + `src/app/test/setup.ts`'s `afterAll`).
 */
export async function runWithCleanup(
  operation: (markPoolMayBeOpen: () => void) => Promise<number>,
  deps: CleanupDeps,
  fallbackErrorCode = 1,
): Promise<number> {
  let poolMayBeOpen = false;
  let code: number;
  try {
    code = await operation(() => {
      poolMayBeOpen = true;
    });
  } catch (err) {
    console.error(err);
    code = fallbackErrorCode;
  } finally {
    try {
      await deps.disposeEmbeddings();
    } catch (err) {
      console.error('Embedding pipeline cleanup failed:', err);
      code = fallbackErrorCode;
    }
    if (poolMayBeOpen) {
      await deps.closePool().catch(err => {
        console.error('DB pool cleanup failed:', err);
      });
    }
  }
  return code;
}
