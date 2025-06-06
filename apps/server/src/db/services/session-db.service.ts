import { BaseDbService } from './base-db.service';
import { db } from '@db/db';
import { aiSessions } from '@db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { AppError } from '@middleware/error';
import { Session } from '@models/ai.types';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

export class SessionDbService extends BaseDbService {
  constructor() {
    super(db);
  }

  async createSession(userId: string, type: Session['type']): Promise<Session> {
    try {
      const [session] = await this.db.insert(aiSessions).values({
        userId,
        sessionType: type,
        summary: '',
        startedAt: new Date(),
        endedAt: null
      }).returning();

      if (!session) throw new AppError(500, 'Failed to create session');

      return {
        id: session.id,
        userId: session.userId!,
        type: session.sessionType as Session['type'],
        summary: session.summary || '',
        startedAt: session.startedAt!,
        endedAt: session.endedAt
      };
    } catch (error) {
      console.error('Error creating session:', error);
      throw new AppError(500, 'Failed to create session');
    }
  }

  async updateSession(sessionId: string, summary: string): Promise<void> {
    try {
      await this.db.update(aiSessions)
        .set({ summary })
        .where(eq(aiSessions.id, sessionId));
    } catch (error) {
      console.error('Error updating session:', error);
      throw new AppError(500, 'Failed to update session');
    }
  }

  async getOpenSession(userId: string): Promise<Session | null> {
    try {
      const session = await this.db.query.aiSessions.findFirst({
        where: and(
          eq(aiSessions.userId, userId),
          isNull(aiSessions.endedAt)
        ),
        orderBy: [desc(aiSessions.startedAt)]
      });

      if (!session) return null;

      return {
        id: session.id,
        userId: session.userId!,
        type: session.sessionType as Session['type'],
        summary: session.summary || '',
        startedAt: session.startedAt!,
        endedAt: session.endedAt
      };
    } catch (error) {
      console.error('Error getting open session:', error);
      throw new AppError(500, 'Failed to get open session');
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      await this.db.update(aiSessions)
        .set({ endedAt: new Date() })
        .where(eq(aiSessions.id, sessionId));
    } catch (error) {
      console.error('Error closing session:', error);
      throw new AppError(500, 'Failed to close session');
    }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    try {
      const session = await this.db.query.aiSessions.findFirst({
        where: eq(aiSessions.id, sessionId)
      });

      if (!session) return null;

      return {
        id: session.id,
        userId: session.userId!,
        type: session.sessionType as Session['type'],
        summary: session.summary || '',
        startedAt: session.startedAt!,
        endedAt: session.endedAt
      };
    } catch (error) {
      console.error('Error getting session:', error);
      throw new AppError(500, 'Failed to get session');
    }
  }

  async getUserSessions(userId: string, limit: number = 10): Promise<Session[]> {
    try {
      const sessions = await this.db.query.aiSessions.findMany({
        where: eq(aiSessions.userId, userId),
        orderBy: [desc(aiSessions.startedAt)],
        limit
      });

      return sessions.map((session: typeof aiSessions.$inferSelect) => ({
        id: session.id,
        userId: session.userId!,
        type: session.sessionType as Session['type'],
        summary: session.summary || '',
        startedAt: session.startedAt!,
        endedAt: session.endedAt
      }));
    } catch (error) {
      console.error('Error getting user sessions:', error);
      throw new AppError(500, 'Failed to get user sessions');
    }
  }
} 