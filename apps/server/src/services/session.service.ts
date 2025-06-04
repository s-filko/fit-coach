import { db } from '@db/db';
import { aiSessions } from '@db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { AppError } from '@middleware/error';
import { Session } from '@/models/ai.types';

export interface ISessionService {
  createSession(userId: string, type: Session['type']): Promise<Session>;
  updateSession(sessionId: string, summary: string): Promise<void>;
  getSession(sessionId: string): Promise<Session | null>;
  getUserSessions(userId: string, limit?: number): Promise<Session[]>;
  getOpenSession(userId: string): Promise<Session | null>;
  closeSession(sessionId: string): Promise<void>;
}

export class SessionService implements ISessionService {
  async createSession(userId: string, type: Session['type']): Promise<Session> {
    try {
      const [session] = await db.insert(aiSessions).values({
        userId,
        sessionType: type,
        summary: '',
        startedAt: new Date(),
        endedAt: null // Сессия создается открытой
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
      await db.update(aiSessions)
        .set({ summary }) // Обновляем только summary, не закрываем сессию
        .where(eq(aiSessions.id, sessionId));
    } catch (error) {
      console.error('Error updating session:', error);
      throw new AppError(500, 'Failed to update session');
    }
  }

  async getOpenSession(userId: string): Promise<Session | null> {
    try {
      const session = await db.query.aiSessions.findFirst({
        where: and(
          eq(aiSessions.userId, userId),
          isNull(aiSessions.endedAt)
        ),
        orderBy: (sessions, { desc }) => [desc(sessions.startedAt)]
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
      await db.update(aiSessions)
        .set({ endedAt: new Date() })
        .where(eq(aiSessions.id, sessionId));
    } catch (error) {
      console.error('Error closing session:', error);
      throw new AppError(500, 'Failed to close session');
    }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    try {
      const session = await db.query.aiSessions.findFirst({
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
      const sessions = await db.query.aiSessions.findMany({
        where: eq(aiSessions.userId, userId),
        orderBy: (sessions, { desc }) => [desc(sessions.startedAt)],
        limit
      });

      return sessions.map(session => ({
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