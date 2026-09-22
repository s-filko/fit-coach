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
    // INV-LLM-010: createdAt stays first — this query spans every run since the
    // cutoff (bucketed into runs below) and is capped by `limit * 4`, so the
    // ORDER BY decides which whole runs the LIMIT keeps, oldest first, not
    // just row order inside one run. seq is the tiebreak WITHIN a tied
    // created_at (closes BUG-029, where that tie left row order at the mercy
    // of physical row layout); putting seq first would sort every NULL-seq
    // pre-migration row (nulls last in ASC) behind every seq'd row — the
    // 2026-09-21 session's turns, cut before any newer run's.
    .orderBy(asc(conversationTurns.createdAt), asc(conversationTurns.seq))
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
