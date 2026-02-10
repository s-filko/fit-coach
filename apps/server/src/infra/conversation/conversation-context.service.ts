import {
  ConversationContext,
  ConversationPhase,
  GetMessagesOptions,
  IConversationContextService,
  ResetOptions,
  StartNewPhaseOptions,
} from '@domain/conversation/ports';
import { ChatMsg } from '@domain/user/ports';

const DEFAULT_MAX_TURNS = 20;

/** In-memory implementation of IConversationContextService [AC-0113] */
export class InMemoryConversationContextService implements IConversationContextService {
  private readonly store = new Map<string, ConversationContext>();

  private key(userId: string, phase: ConversationPhase): string {
    return `${userId}:${phase}`;
  }

  /** [BR-CONV-001] */
  async getContext(userId: string, phase: ConversationPhase): Promise<ConversationContext | null> {
    return this.store.get(this.key(userId, phase)) ?? null;
  }

  /** [BR-CONV-002] */
  async appendTurn(
    userId: string, phase: ConversationPhase,
    userContent: string, assistantContent: string,
  ): Promise<void> {
    const k = this.key(userId, phase);
    const now = new Date();

    let ctx = this.store.get(k);
    if (!ctx) {
      ctx = { userId, phase, turns: [], lastActivityAt: now };
      this.store.set(k, ctx);
    }

    ctx.turns.push(
      { role: 'user', content: userContent, timestamp: now },
      { role: 'assistant', content: assistantContent, timestamp: now },
    );
    ctx.lastActivityAt = now;
  }

  /** [BR-CONV-003][BR-CONV-004][INV-CONV-003] */
  getMessagesForPrompt(ctx: ConversationContext, options?: GetMessagesOptions): ChatMsg[] {
    const maxTurns = options?.maxTurns ?? DEFAULT_MAX_TURNS;

    // Filter to prompt-relevant roles and apply sliding window
    const relevant = ctx.turns.filter(
      t => t.role === 'user' || t.role === 'assistant' || t.role === 'system',
    );
    const windowed = relevant.slice(-maxTurns);

    // Map ConversationTurn → ChatMsg
    const messages: ChatMsg[] = windowed.map(t => ({
      role: t.role === 'system' ? 'system' as const : t.role as 'user' | 'assistant',
      content: t.content,
    }));

    // Prepend summary if present [BR-CONV-004]
    if (ctx.summarySoFar) {
      messages.unshift({ role: 'system', content: ctx.summarySoFar });
    }

    return messages;
  }

  /** [BR-CONV-005] */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async reset(userId: string, phase: ConversationPhase, options?: ResetOptions): Promise<void> {
    this.store.delete(this.key(userId, phase));
  }

  /** No-op stub for post-MVP [BR-CONV-006] */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async summarize(userId: string, phase: ConversationPhase): Promise<void> {
    // Post-MVP: summarize older turns via LLM
  }

  /** [BR-CONV-005] */
  async startNewPhase(
    userId: string, fromPhase: ConversationPhase, toPhase: ConversationPhase,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    systemNote: string, options?: StartNewPhaseOptions,
  ): Promise<void> {
    // Reset old phase
    this.store.delete(this.key(userId, fromPhase));

    // Create new phase with system note
    const now = new Date();
    this.store.set(this.key(userId, toPhase), {
      userId,
      phase: toPhase,
      turns: [{ role: 'system', content: systemNote, timestamp: now }],
      lastActivityAt: now,
    });
  }
}
