import {
  ConversationContext,
  ConversationPhase,
  GetMessagesOptions,
  IConversationContextService,
  PHASE_ENDED_PREFIX,
  ResetOptions,
  SessionPlanningContext,
  StartNewPhaseOptions,
  TrainingContext,
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
    const ctx = this.store.get(this.key(userId, phase)) ?? null;
    if (!ctx || ctx.turns.length === 0) {
      return null;
    }

    // Check if phase is closed
    const lastTurn = ctx.turns[ctx.turns.length - 1];
    if (lastTurn.role === 'system' && lastTurn.content.startsWith(PHASE_ENDED_PREFIX)) {
      return null;
    }

    // Scope to current cycle: find last non-PHASE_ENDED system note
    let cycleStartIdx = 0;
    for (let i = ctx.turns.length - 1; i >= 0; i--) {
      if (ctx.turns[i].role === 'system' && !ctx.turns[i].content.startsWith(PHASE_ENDED_PREFIX)) {
        cycleStartIdx = i;
        break;
      }
    }

    return {
      ...ctx,
      turns: ctx.turns.slice(cycleStartIdx),
    };
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
      // Create phase-appropriate context
      ctx = this.createEmptyContext(userId, phase, now);
      this.store.set(k, ctx);
    }

    ctx.turns.push(
      { role: 'user', content: userContent, timestamp: now },
      { role: 'assistant', content: assistantContent, timestamp: now },
    );
    ctx.lastActivityAt = now;
  }

  private createEmptyContext(userId: string, phase: ConversationPhase, now: Date): ConversationContext {
    const base = { userId, turns: [], lastActivityAt: now };
    
    switch (phase) {
      case 'registration':
        return { ...base, phase: 'registration' };
      case 'chat':
        return { ...base, phase: 'chat' };
      case 'plan_creation':
        return { ...base, phase: 'plan_creation' };
      case 'session_planning':
        return { ...base, phase: 'session_planning' };
      case 'training':
        // Training phase requires activeSessionId, but we can't create it here
        // This should be handled by startNewPhase with proper context
        throw new Error('Training phase context must be created via startNewPhase with trainingContext');
      default:
        throw new Error(`Unknown phase: ${phase as string}`);
    }
  }

  /** [BR-CONV-003][BR-CONV-004][INV-CONV-003] */
  getMessagesForPrompt(ctx: ConversationContext, options?: GetMessagesOptions): ChatMsg[] {
    const maxTurns = options?.maxTurns ?? DEFAULT_MAX_TURNS;

    const relevant = ctx.turns.filter(
      t => (t.role === 'user' || t.role === 'assistant' || t.role === 'system')
        && !t.content.startsWith(PHASE_ENDED_PREFIX),
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

  /** [BR-CONV-005] No-op: history is preserved. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async reset(userId: string, phase: ConversationPhase, options?: ResetOptions): Promise<void> {
    // History is never deleted; getContext scopes to current cycle
  }

  /** No-op stub for post-MVP [BR-CONV-006] */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async summarize(userId: string, phase: ConversationPhase): Promise<void> {
    // Post-MVP: summarize older turns via LLM
  }

  /** [BR-CONV-005][BR-CONV-010][BR-CONV-011] */
  async startNewPhase(
    userId: string, fromPhase: ConversationPhase, toPhase: ConversationPhase,
    systemNote: string, options?: StartNewPhaseOptions,
  ): Promise<void> {
    const now = new Date();

    // Mark old phase as ended (history preserved, not deleted)
    const fromCtx = this.store.get(this.key(userId, fromPhase));
    if (fromCtx) {
      fromCtx.turns.push({
        role: 'system', content: `${PHASE_ENDED_PREFIX} ${systemNote}`, timestamp: now,
      });
    }

    // Create or update target phase context
    const toKey = this.key(userId, toPhase);
    const existingToCtx = this.store.get(toKey);

    if (existingToCtx) {
      // Phase re-entry: append system note to existing turns
      existingToCtx.turns.push({ role: 'system', content: systemNote, timestamp: now });
      existingToCtx.lastActivityAt = now;
      if (toPhase === 'session_planning' && existingToCtx.phase === 'session_planning' && options?.sessionPlanningContext) {
        existingToCtx.sessionPlanningContext = options.sessionPlanningContext;
      } else if (toPhase === 'training' && existingToCtx.phase === 'training') {
        if (!options?.trainingContext?.activeSessionId) {
          throw new Error('trainingContext with activeSessionId is required for training phase');
        }
        existingToCtx.trainingContext = options.trainingContext;
      }
    } else {
      // New phase entry
      const baseTurns = [{ role: 'system' as const, content: systemNote, timestamp: now }];
      let newContext: ConversationContext;

      switch (toPhase) {
        case 'registration':
          newContext = { userId, phase: 'registration', turns: baseTurns, lastActivityAt: now };
          break;
        case 'chat':
          newContext = { userId, phase: 'chat', turns: baseTurns, lastActivityAt: now };
          break;
        case 'plan_creation':
          newContext = {
            userId, phase: 'plan_creation', turns: baseTurns, lastActivityAt: now,
            planCreationContext: options?.planCreationContext,
          };
          break;
        case 'session_planning':
          newContext = {
            userId, phase: 'session_planning', turns: baseTurns, lastActivityAt: now,
            sessionPlanningContext: options?.sessionPlanningContext,
          };
          break;
        case 'training':
          if (!options?.trainingContext?.activeSessionId) {
            throw new Error('trainingContext with activeSessionId is required for training phase');
          }
          newContext = {
            userId, phase: 'training', turns: baseTurns, lastActivityAt: now,
            trainingContext: options.trainingContext,
          };
          break;
        default:
          throw new Error(`Unknown phase: ${toPhase as string}`);
      }

      this.store.set(toKey, newContext);
    }
  }

  /** Update phase-specific context (e.g., cache session plan) */
  async updatePhaseContext(
    userId: string,
    phase: ConversationPhase,
    context: SessionPlanningContext | TrainingContext,
  ): Promise<void> {
    if (phase !== 'session_planning' && phase !== 'training') {
      throw new Error(`updatePhaseContext is only supported for session_planning and training, got: ${phase}`);
    }

    const k = this.key(userId, phase);
    const existing = this.store.get(k);

    if (phase === 'session_planning') {
      if (existing && existing.phase === 'session_planning') {
        existing.sessionPlanningContext = context as SessionPlanningContext;
      }
      // If no context exists yet (first message in phase), store it separately
      // so getContext() can attach it later
    } else if (phase === 'training') {
      if (existing && existing.phase === 'training') {
        existing.trainingContext = context as TrainingContext;
      }
    }
  }
}
