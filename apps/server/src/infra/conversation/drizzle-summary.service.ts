import type { InsertSummaryInput, LegacySummary, SummaryPort } from '@domain/conversation/ports';

export interface SummaryInsertRow {
  userId: string;
  runId: string;
  episodeId: string;
  phaseAtEnd: InsertSummaryInput['phaseAtEnd'];
  structured: InsertSummaryInput['structured'];
  rendered: string;
  createdAt: Date;
}

export interface SummaryTurnRow {
  userId: string;
  phase: InsertSummaryInput['phaseAtEnd'];
  runId: string;
  kind: 'summary';
  role: 'summary';
  content: string;
  payload: InsertSummaryInput['structured'];
  /** AC-AT-4: this run's next turn, not a system note — see `insert` for how `seq` is resolved. */
  seq: number;
}

/** The `conversation_summaries` row shape (pure mapping, exported for unit tests). */
export function toSummaryInsert(input: InsertSummaryInput): SummaryInsertRow {
  return {
    userId: input.userId,
    runId: input.runId,
    episodeId: input.episodeId,
    phaseAtEnd: input.phaseAtEnd,
    structured: input.structured,
    rendered: input.rendered,
    createdAt: new Date(),
  };
}

/** The mirrored `kind='summary'` turn row (D-K) — what a P3 rollback reads as context. */
export function toSummaryTurnRow(input: InsertSummaryInput, seq: number): SummaryTurnRow {
  return {
    userId: input.userId,
    phase: input.phaseAtEnd,
    runId: input.runId,
    kind: 'summary',
    role: 'summary',
    content: input.rendered,
    payload: input.structured,
    seq,
  };
}

/** SummaryPort adapter. `insert` writes both rows in one transaction (all or nothing). */
export class DrizzleSummaryService implements SummaryPort {
  async insert(input: InsertSummaryInput): Promise<{ summaryTurnId: string }> {
    const { db } = await import('@infra/db/drizzle');
    const { conversationSummaries, conversationTurns } = await import('@infra/db/schema');
    const { eq, max } = await import('drizzle-orm');
    const summaryRow = toSummaryInsert(input);
    return db.transaction(async tx => {
      await tx.insert(conversationSummaries).values(summaryRow);
      // Close-out R2 finding 6: the summary is this run's own next turn — auto-compaction can
      // fire mid-run (compact.node.ts), alongside the run's other, already-seq'd turns — so it
      // is numbered the same way appendRunMessages numbers a run's other turns (MAX(seq) WHERE
      // run_id, +1), never left null. Read inside the same transaction, both for this and for
      // the existing reason: the mirrored turn row's id is the fact-extraction provenance
      // (fact-lifecycle plan Task 1).
      const [{ maxSeq }] = await tx
        .select({ maxSeq: max(conversationTurns.seq) })
        .from(conversationTurns)
        .where(eq(conversationTurns.runId, input.runId));
      const [turn] = await tx
        .insert(conversationTurns)
        .values(toSummaryTurnRow(input, (maxSeq ?? 0) + 1))
        .returning({ id: conversationTurns.id });
      return { summaryTurnId: turn.id };
    });
  }

  async latestLegacySummary(userId: string): Promise<LegacySummary | null> {
    const { db } = await import('@infra/db/drizzle');
    const { conversationTurns } = await import('@infra/db/schema');
    const { and, desc, eq } = await import('drizzle-orm');
    const rows = await db
      .select()
      .from(conversationTurns)
      .where(and(eq(conversationTurns.userId, userId), eq(conversationTurns.role, 'summary')))
      .orderBy(desc(conversationTurns.createdAt))
      .limit(1);
    const [row] = rows;
    if (row === undefined) {
      return null;
    }
    return { text: row.content, phase: row.phase, createdAt: row.createdAt };
  }
}
