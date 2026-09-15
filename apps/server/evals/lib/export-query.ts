import { and, asc, gte, isNotNull } from 'drizzle-orm';

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
    .orderBy(asc(conversationTurns.createdAt))
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

  return runs.map(run => ({
    runId: run.runId,
    userId: run.userId,
    phase: run.phaseIn,
    createdAt: run.createdAt,
    model: run.model,
    turns: byRun.get(run.runId) ?? [],
  }));
}
