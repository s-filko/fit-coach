import { ConversationPhase, GetMessagesOptions, IConversationContextService } from '@domain/conversation/ports';
import { ChatMsg } from '@domain/user/ports';

// TODO: remove — in-memory implementation kept only for tests; real impl is DrizzleConversationContextService
export class InMemoryConversationContextService implements IConversationContextService {
  private readonly turns = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();
  private readonly summaries = new Map<string, string>();

  private key(userId: string, phase: ConversationPhase): string {
    return `${userId}:${phase}`;
  }

  async appendTurn(
    userId: string,
    phase: ConversationPhase,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    const k = this.key(userId, phase);
    const list = this.turns.get(k) ?? [];
    list.push({ role: 'user', content: userContent });
    list.push({ role: 'assistant', content: assistantContent });
    this.turns.set(k, list);
  }

  async getMessagesForPrompt(
    userId: string,
    phase: ConversationPhase,
    options?: GetMessagesOptions,
  ): Promise<ChatMsg[]> {
    const k = this.key(userId, phase);
    const list = this.turns.get(k) ?? [];
    const maxPairs = options?.maxTurns ?? 20;
    return list.slice(-maxPairs * 2) as ChatMsg[];
  }

  async insertContextReset(userId: string): Promise<void> {
    for (const key of this.turns.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.turns.delete(key);
      }
    }
  }

  async insertPhaseSummary(userId: string, _phase: ConversationPhase, summary: string): Promise<void> {
    this.summaries.set(userId, summary);
  }

  async getLatestSummary(userId: string): Promise<string | null> {
    return this.summaries.get(userId) ?? null;
  }

  async getLastUserMessageTime(_userId: string): Promise<Date | null> {
    return null;
  }
}
