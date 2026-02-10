import { and, asc, eq } from 'drizzle-orm';

import {
  ConversationContext,
  ConversationPhase,
  ConversationTurn,
  GetMessagesOptions,
  IConversationContextService,
  ResetOptions,
  StartNewPhaseOptions,
} from '@domain/conversation/ports';
import { ChatMsg } from '@domain/user/ports';

import type { conversationTurns } from '@infra/db/schema';

type TurnRow = typeof conversationTurns.$inferSelect;

const DEFAULT_MAX_TURNS = 20;

/** Lazy import to avoid circular dependency at module init time */
async function getDbAndSchema() {
  const { db } = await import('@infra/db/drizzle');
  const { conversationTurns } = await import('@infra/db/schema');
  return { db, conversationTurns };
}

function mapRowToTurn(row: TurnRow): ConversationTurn {
  return {
    role: row.role,
    content: row.content,
    timestamp: row.createdAt,
  };
}

/** Drizzle-backed implementation of IConversationContextService (ADR-0005) */
export class DrizzleConversationContextService implements IConversationContextService {

  /** [BR-CONV-001] Load all turns for (userId, phase) from DB */
  async getContext(userId: string, phase: ConversationPhase): Promise<ConversationContext | null> {
    const { db, conversationTurns } = await getDbAndSchema();

    const rows = await db
      .select()
      .from(conversationTurns)
      .where(and(
        eq(conversationTurns.userId, userId),
        eq(conversationTurns.phase, phase),
      ))
      .orderBy(asc(conversationTurns.createdAt));

    if (rows.length === 0) {
      return null;
    }

    const turns = rows.map(mapRowToTurn);

    // Extract summarySoFar: content of the last 'summary' row (if any)
    const summaryRow = rows.filter(r => r.role === 'summary').pop();
    const summarySoFar = summaryRow?.content;

    // lastActivityAt: created_at of the very last row
    const lastActivityAt = rows[rows.length - 1].createdAt;

    return { userId, phase, turns, summarySoFar, lastActivityAt };
  }

  /** [BR-CONV-002] INSERT 2 rows (user + assistant) */
  async appendTurn(
    userId: string, phase: ConversationPhase,
    userContent: string, assistantContent: string,
  ): Promise<void> {
    const { db, conversationTurns } = await getDbAndSchema();

    await db.insert(conversationTurns).values([
      { userId, phase, role: 'user', content: userContent },
      { userId, phase, role: 'assistant', content: assistantContent },
    ]);
  }

  /**
   * [BR-CONV-003][BR-CONV-004][INV-CONV-003]
   * Pure computation — identical logic to InMemoryConversationContextService.
   */
  getMessagesForPrompt(ctx: ConversationContext, options?: GetMessagesOptions): ChatMsg[] {
    const maxTurns = options?.maxTurns ?? DEFAULT_MAX_TURNS;

    const relevant = ctx.turns.filter(
      t => t.role === 'user' || t.role === 'assistant' || t.role === 'system',
    );
    const windowed = relevant.slice(-maxTurns);

    const messages: ChatMsg[] = windowed.map(t => ({
      role: t.role === 'system' ? 'system' as const : t.role as 'user' | 'assistant',
      content: t.content,
    }));

    if (ctx.summarySoFar) {
      messages.unshift({ role: 'system', content: ctx.summarySoFar });
    }

    return messages;
  }

  /** [BR-CONV-005] DELETE all rows for (userId, phase) */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async reset(userId: string, phase: ConversationPhase, options?: ResetOptions): Promise<void> {
    const { db, conversationTurns } = await getDbAndSchema();

    await db
      .delete(conversationTurns)
      .where(and(
        eq(conversationTurns.userId, userId),
        eq(conversationTurns.phase, phase),
      ));
  }

  /** No-op stub for post-MVP [BR-CONV-006] */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async summarize(userId: string, phase: ConversationPhase): Promise<void> {
    // Post-MVP: summarize older turns via LLM, insert a 'summary' row
  }

  /** [BR-CONV-005] Delete fromPhase rows, insert system note into toPhase */
  async startNewPhase(
    userId: string, fromPhase: ConversationPhase, toPhase: ConversationPhase,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    systemNote: string, options?: StartNewPhaseOptions,
  ): Promise<void> {
    const { db, conversationTurns } = await getDbAndSchema();

    // Delete old phase
    await db
      .delete(conversationTurns)
      .where(and(
        eq(conversationTurns.userId, userId),
        eq(conversationTurns.phase, fromPhase),
      ));

    // Create new phase with system note
    await db.insert(conversationTurns).values({
      userId, phase: toPhase, role: 'system', content: systemNote,
    });
  }
}
