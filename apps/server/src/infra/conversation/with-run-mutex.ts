/**
 * `withRunMutex` (D-A, D-12, ADR-0013 §6/§11): a decorator around
 * `ConversationRunPort` that serialises `run`, `clearContext` and `compact` calls per
 * `userId` through the in-process keyed mutex (`keyed-mutex.ts`). Composed at
 * the composition root (`register-infra-services.ts`) — the adapter itself
 * (`conversation-run.adapter.ts`) is untouched and knows nothing about
 * concurrency.
 *
 * `clearContext` shares the `run` mutex key because it deletes the
 * checkpointed thread (messages channel and episode state, D-F) — running it
 * concurrently with a `run` on the same thread is exactly the corruption the
 * mutex exists to prevent (master plan item 1 names only `graph.invoke`, but
 * the hazard is the thread, not the method).
 *
 * A waiter rejected by the mutex throws `ThreadBusyError` before the graph is
 * ever entered — no run row is written for it (D-D); the caller (the route)
 * maps it to HTTP 409 via `HTTP_STATUS_BY_CODE`.
 *
 * This mutex is in-process and single-instance by stated constraint (P5
 * Global Constraints). The multi-instance successor is
 * `pg_advisory_xact_lock(hashtext(userId))` at this same seam — not
 * implemented here.
 */
import type { CompactOutcome, ConversationRunPort, RunInput, RunResult } from '@domain/conversation/ports';

import { createKeyedMutex } from '@infra/conversation/keyed-mutex';

export interface WithRunMutexOptions {
  waitMs: number;
}

export function withRunMutex(port: ConversationRunPort, opts: WithRunMutexOptions): ConversationRunPort {
  const mutex = createKeyedMutex({ waitMs: opts.waitMs });

  return {
    run(input: RunInput): Promise<RunResult> {
      return mutex.run(input.userId, () => port.run(input));
    },
    clearContext(userId: string): Promise<void> {
      return mutex.run(userId, () => port.clearContext(userId));
    },
    // Same key as `run`: a compaction rewrites the checkpointed channel.
    compact(userId: string): Promise<CompactOutcome> {
      return mutex.run(userId, () => port.compact(userId));
    },
  };
}
