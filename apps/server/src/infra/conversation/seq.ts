import type { db } from '@infra/db/drizzle';

type Executor = Pick<typeof db, 'select'>;

/**
 * INV-LLM-010: this run's next `conversation_turns.seq` — `MAX(seq) WHERE run_id` + 1, never left null.
 * One policy, called from inside whatever transaction the caller is already in (`db` or a `tx`),
 * so `appendRunMessages` and the summary mirror-turn insert cannot disagree about how numbering
 * works — two copies of this read would, and the order of a run's rows is the whole point.
 */
export async function nextSeqForRun(executor: Executor, runId: string): Promise<number> {
  const { conversationTurns } = await import('@infra/db/schema');
  const { eq, max } = await import('drizzle-orm');
  const [{ maxSeq }] = await executor
    .select({ maxSeq: max(conversationTurns.seq) })
    .from(conversationTurns)
    .where(eq(conversationTurns.runId, runId));
  return (maxSeq ?? 0) + 1;
}
