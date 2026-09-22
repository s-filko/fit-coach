import { and, asc, eq, gte, isNotNull, lte } from 'drizzle-orm';

export interface ExportedRun {
  runId: string | null;
  userId: string;
  phase: string;
  createdAt: Date;
  model: string | null;
  turns: Array<{ role: string; kind: string; content: string; createdAt: Date }>;
}

export async function fetchRunsSince(since: Date, limit: number): Promise<ExportedRun[]> {
  const { db } = await import('@infra/db/drizzle');
  const { conversationRuns, conversationTurns } = await import('@infra/db/schema');

  const runs = await db
    .select({
      runId: conversationRuns.runId,
      userId: conversationRuns.userId,
      phaseIn: conversationRuns.phaseIn,
      model: conversationRuns.model,
      createdAt: conversationRuns.createdAt,
      latencyMs: conversationRuns.latencyMs,
    })
    .from(conversationRuns)
    .where(gte(conversationRuns.createdAt, since))
    .orderBy(asc(conversationRuns.createdAt))
    .limit(limit);

  const turns = await db
    .select({
      userId: conversationTurns.userId,
      runId: conversationTurns.runId,
      role: conversationTurns.role,
      kind: conversationTurns.kind,
      content: conversationTurns.content,
      createdAt: conversationTurns.createdAt,
    })
    .from(conversationTurns)
    .where(and(gte(conversationTurns.createdAt, since), isNotNull(conversationTurns.runId)))
    // AC-AT-4: seq (nulls last) is the recoverable order within a run — closes
    // BUG-029, where tied created_at left this ORDER BY at the mercy of
    // physical row layout. createdAt stays as the tiebreak for pre-migration
    // rows, whose seq is null, so their relative order is unchanged from before.
    .orderBy(asc(conversationTurns.seq), asc(conversationTurns.createdAt))
    .limit(limit * 4);

  const byRun = new Map<string, ExportedRun['turns']>();
  for (const turn of turns) {
    if (!turn.runId) {
      continue;
    }
    const bucket = byRun.get(turn.runId) ?? [];
    bucket.push({ role: turn.role, kind: turn.kind, content: turn.content, createdAt: turn.createdAt });
    byRun.set(turn.runId, bucket);
  }

  const out: ExportedRun[] = [];
  for (const run of runs) {
    let runTurns = byRun.get(run.runId);
    if (!runTurns || runTurns.length === 0) {
      // Fallback join (post-execution correction 2026-09-15): production appendTurn
      // does not thread runId (BUG-016), so all turns may carry run_id = NULL.
      // Window-join the user's turns using the run's own timestamps —
      // [createdAt − latencyMs, createdAt] — without inventing precision.
      const start = new Date(run.createdAt.getTime() - run.latencyMs);
      const end = run.createdAt;
      const windowed = await db
        .select({
          role: conversationTurns.role,
          kind: conversationTurns.kind,
          content: conversationTurns.content,
          createdAt: conversationTurns.createdAt,
        })
        .from(conversationTurns)
        .where(
          and(
            eq(conversationTurns.userId, run.userId),
            gte(conversationTurns.createdAt, start),
            lte(conversationTurns.createdAt, end),
          ),
        )
        .orderBy(asc(conversationTurns.createdAt));
      runTurns = windowed.map(t => ({ role: t.role, kind: t.kind, content: t.content, createdAt: t.createdAt }));
    }
    out.push({
      runId: run.runId,
      userId: run.userId,
      phase: run.phaseIn,
      createdAt: run.createdAt,
      model: run.model,
      turns: runTurns,
    });
  }
  return out;
}
