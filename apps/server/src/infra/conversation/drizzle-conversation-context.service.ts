import { and, desc, eq, gt } from 'drizzle-orm';

import { ConversationPhase, GetMessagesOptions, IConversationContextService } from '@domain/conversation/ports';
import { ChatMsg } from '@domain/user/ports';

const DEFAULT_MAX_TURNS = 20;
export const CONTEXT_RESET_MARKER = '__context_reset__';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function getDbAndSchema() {
  const { db } = await import('@infra/db/drizzle');
  const { conversationTurns } = await import('@infra/db/schema');
  return { db, conversationTurns };
}

export class DrizzleConversationContextService implements IConversationContextService {
  async appendTurn(
    userId: string,
    phase: ConversationPhase,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    const { db, conversationTurns } = await getDbAndSchema();

    await db.insert(conversationTurns).values([
      { userId, phase, role: 'user', content: userContent },
      { userId, phase, role: 'assistant', content: assistantContent },
    ]);
  }

  async insertContextReset(userId: string): Promise<void> {
    const { db, conversationTurns } = await getDbAndSchema();
    await db.insert(conversationTurns).values({
      userId,
      phase: 'chat',
      role: 'system',
      content: CONTEXT_RESET_MARKER,
    });
  }

  async getMessagesForPrompt(
    userId: string,
    phase: ConversationPhase,
    options?: GetMessagesOptions,
  ): Promise<ChatMsg[]> {
    const { db, conversationTurns } = await getDbAndSchema();
    const maxTurns = (options?.maxTurns ?? DEFAULT_MAX_TURNS) * 2;

    const [lastReset] = await db
      .select({ createdAt: conversationTurns.createdAt })
      .from(conversationTurns)
      .where(and(eq(conversationTurns.userId, userId), eq(conversationTurns.content, CONTEXT_RESET_MARKER)))
      .orderBy(desc(conversationTurns.createdAt))
      .limit(1);

    const afterReset = lastReset ? gt(conversationTurns.createdAt, lastReset.createdAt) : undefined;

    const whereClause = afterReset
      ? and(eq(conversationTurns.userId, userId), eq(conversationTurns.phase, phase), afterReset)
      : and(eq(conversationTurns.userId, userId), eq(conversationTurns.phase, phase));

    const rows = await db
      .select({ role: conversationTurns.role, content: conversationTurns.content })
      .from(conversationTurns)
      .where(whereClause)
      .orderBy(desc(conversationTurns.createdAt))
      .limit(maxTurns);

    return rows
      .reverse()
      .filter(r => r.role === 'user' || r.role === 'assistant')
      .map(r => ({ role: r.role as 'user' | 'assistant', content: r.content }));
  }

  async insertPhaseSummary(userId: string, phase: ConversationPhase, summary: string): Promise<void> {
    const { db, conversationTurns } = await getDbAndSchema();
    await db.insert(conversationTurns).values({
      userId,
      phase,
      role: 'summary',
      content: summary,
    });
  }

  async getLatestSummary(userId: string): Promise<string | null> {
    const { db, conversationTurns } = await getDbAndSchema();
    const [row] = await db
      .select({ content: conversationTurns.content })
      .from(conversationTurns)
      .where(and(eq(conversationTurns.userId, userId), eq(conversationTurns.role, 'summary')))
      .orderBy(desc(conversationTurns.createdAt))
      .limit(1);
    return row?.content ?? null;
  }
}
