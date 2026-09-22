import type { ConversationRunRecord, IConversationRunService } from '@domain/conversation/ports';

export class DrizzleConversationRunService implements IConversationRunService {
  async recordRun(record: ConversationRunRecord): Promise<void> {
    const { db } = await import('@infra/db/drizzle');
    const { conversationRuns } = await import('@infra/db/schema');

    await db.insert(conversationRuns).values({
      runId: record.runId,
      userId: record.userId,
      phaseIn: record.phaseIn,
      phaseOut: record.phaseOut,
      trigger: record.trigger,
      client: record.client,
      // Null for runs that failed before any model call (D-F; column nullable since 2026-09-18)
      model: record.model,
      promptVersions: record.promptVersions,
      tokensIn: record.tokensIn,
      tokensOut: record.tokensOut,
      latencyMs: record.latencyMs,
      toolCalls: record.toolCalls,
      transition: record.transition,
      outcome: record.outcome,
      budgetReport: record.budgetReport,
      // AC-AT-2: null for an 'ok' run — the commit node never sets these (optional on the type).
      errorClass: record.errorClass ?? null,
      errorMessage: record.errorMessage ?? null,
    });
  }
}
