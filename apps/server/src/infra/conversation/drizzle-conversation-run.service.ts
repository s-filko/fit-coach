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
      // Column is NOT NULL (schema.ts) — the null model of a failed run keeps the
      // "unknown" sentinel until a migration widens it (noted in the plan, D-F).
      model: record.model ?? 'unknown',
      promptVersions: record.promptVersions,
      tokensIn: record.tokensIn,
      tokensOut: record.tokensOut,
      latencyMs: record.latencyMs,
      toolCalls: record.toolCalls,
      transition: record.transition,
      outcome: record.outcome,
      budgetReport: record.budgetReport,
    });
  }
}
