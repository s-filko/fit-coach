import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';

import {
  ConversationContext,
  ConversationPhase,
  ConversationTurn,
  GetMessagesOptions,
  IConversationContextService,
  PHASE_ENDED_PREFIX,
  ResetOptions,
  SessionPlanningContext,
  StartNewPhaseOptions,
  TrainingContext,
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
  // In-memory store for phase-specific context (MVP: not persisted to DB)
  private readonly phaseContextStore = new Map<string, SessionPlanningContext | TrainingContext>();

  private contextKey(userId: string, phase: ConversationPhase): string {
    return `${userId}:${phase}`;
  }

  /** [BR-CONV-001] Load current-cycle turns for (userId, phase) from DB */
  async getContext(userId: string, phase: ConversationPhase): Promise<ConversationContext | null> {
    const { db, conversationTurns } = await getDbAndSchema();

    // Lightweight check: is the phase closed? (avoids loading all turns for inactive phases)
    const [lastRow] = await db
      .select({ role: conversationTurns.role, content: conversationTurns.content })
      .from(conversationTurns)
      .where(and(
        eq(conversationTurns.userId, userId),
        eq(conversationTurns.phase, phase),
      ))
      .orderBy(desc(conversationTurns.createdAt))
      .limit(1);

    if (!lastRow) {
      return null;
    }
    if (lastRow.role === 'system' && lastRow.content.startsWith(PHASE_ENDED_PREFIX)) {
      return null;
    }

    // Find the start of the current cycle (last non-PHASE_ENDED system note)
    const [cycleStartRow] = await db
      .select({ createdAt: conversationTurns.createdAt })
      .from(conversationTurns)
      .where(and(
        eq(conversationTurns.userId, userId),
        eq(conversationTurns.phase, phase),
        eq(conversationTurns.role, 'system'),
        sql`${conversationTurns.content} NOT LIKE ${PHASE_ENDED_PREFIX + '%'}`,
      ))
      .orderBy(desc(conversationTurns.createdAt))
      .limit(1);

    // Load current cycle turns only (from cycle start, or all if no system note exists)
    const whereClause = cycleStartRow
      ? and(
        eq(conversationTurns.userId, userId),
        eq(conversationTurns.phase, phase),
        gte(conversationTurns.createdAt, cycleStartRow.createdAt),
      )
      : and(
        eq(conversationTurns.userId, userId),
        eq(conversationTurns.phase, phase),
      );

    const rows = await db
      .select()
      .from(conversationTurns)
      .where(whereClause)
      .orderBy(asc(conversationTurns.createdAt));

    if (rows.length === 0) {
      return null;
    }

    const turns = rows.map(mapRowToTurn);

    const summaryRow = rows.filter(r => r.role === 'summary').pop();
    const summarySoFar = summaryRow?.content;
    const lastActivityAt = rows[rows.length - 1].createdAt;

    const baseContext = { userId, turns, summarySoFar, lastActivityAt };
    const key = this.contextKey(userId, phase);
    
    switch (phase) {
      case 'registration':
        return { ...baseContext, phase: 'registration' };
      case 'chat':
        return { ...baseContext, phase: 'chat' };
      case 'plan_creation':
        return { ...baseContext, phase: 'plan_creation' };
      case 'session_planning': {
        const planningContext = this.phaseContextStore.get(key) as SessionPlanningContext | undefined;
        return {
          ...baseContext,
          phase: 'session_planning',
          sessionPlanningContext: planningContext,
        };
      }
      case 'training': {
        let trainingContext = this.phaseContextStore.get(key) as TrainingContext | undefined;
        
        if (!trainingContext?.activeSessionId) {
          const { workoutSessions } = await import('@infra/db/schema');
          const [activeSession] = await db
            .select({ id: workoutSessions.id })
            .from(workoutSessions)
            .where(and(
              eq(workoutSessions.userId, userId),
              eq(workoutSessions.status, 'in_progress'),
            ))
            .limit(1);
          
          if (activeSession) {
            trainingContext = { activeSessionId: activeSession.id };
            this.phaseContextStore.set(key, trainingContext);
          } else {
            return null;
          }
        }
        
        return { ...baseContext, phase: 'training', trainingContext };
      }
      default:
        return null;
    }
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
   * getContext already scopes turns to the current cycle; this applies the sliding window.
   */
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

  /** [BR-CONV-005] No-op: history is preserved. Only clears in-memory phase context. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async reset(userId: string, phase: ConversationPhase, options?: ResetOptions): Promise<void> {
    this.phaseContextStore.delete(this.contextKey(userId, phase));
  }

  /** No-op stub for post-MVP [BR-CONV-006] */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async summarize(userId: string, phase: ConversationPhase): Promise<void> {
    // Post-MVP: summarize older turns via LLM, insert a 'summary' row
  }

  /** [BR-CONV-005][BR-CONV-010][BR-CONV-011] Mark fromPhase as ended, insert system note into toPhase */
  async startNewPhase(
    userId: string, fromPhase: ConversationPhase, toPhase: ConversationPhase,
    systemNote: string, options?: StartNewPhaseOptions,
  ): Promise<void> {
    const { db, conversationTurns } = await getDbAndSchema();

    // Mark old phase as ended (history preserved, not deleted)
    await db.insert(conversationTurns).values({
      userId, phase: fromPhase, role: 'system',
      content: `${PHASE_ENDED_PREFIX} ${systemNote}`,
    });
    
    this.phaseContextStore.delete(this.contextKey(userId, fromPhase));

    // Create new phase with system note
    await db.insert(conversationTurns).values({
      userId, phase: toPhase, role: 'system', content: systemNote,
    });
    
    const toKey = this.contextKey(userId, toPhase);
    if (toPhase === 'session_planning' && options?.sessionPlanningContext) {
      this.phaseContextStore.set(toKey, options.sessionPlanningContext);
    } else if (toPhase === 'training') {
      if (!options?.trainingContext?.activeSessionId) {
        throw new Error('trainingContext with activeSessionId is required for training phase');
      }
      this.phaseContextStore.set(toKey, options.trainingContext);
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

    const key = this.contextKey(userId, phase);
    const existing = this.phaseContextStore.get(key);
    // Merge with existing context to preserve fields not being updated
    this.phaseContextStore.set(key, { ...existing, ...context });
  }
}
