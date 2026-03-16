import { desc, eq } from 'drizzle-orm';

import { ConversationPhase, GetMessagesOptions, IConversationContextService } from '@domain/conversation/ports';
import { ChatMsg } from '@domain/user/ports';

const DEFAULT_MAX_TURNS = 20;

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

  async getMessagesForPrompt(
    userId: string,
    phase: ConversationPhase,
    options?: GetMessagesOptions,
  ): Promise<ChatMsg[]> {
    const { db, conversationTurns } = await getDbAndSchema();
    const maxTurns = (options?.maxTurns ?? DEFAULT_MAX_TURNS) * 2; // pairs of user+assistant

    const rows = await db
      .select({ role: conversationTurns.role, content: conversationTurns.content })
      .from(conversationTurns)
      .where(eq(conversationTurns.userId, userId))
      .orderBy(desc(conversationTurns.createdAt), desc(conversationTurns.id))
      .limit(maxTurns);

    // Reverse to chronological order and filter to user/assistant only
    return rows
      .reverse()
      .filter(r => r.role === 'user' || r.role === 'assistant')
      .map(r => ({ role: r.role as 'user' | 'assistant', content: r.content }));
  }
}
