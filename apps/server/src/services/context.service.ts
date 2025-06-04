import { db } from '@db/db';
import { users } from '@db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '@middleware/error';
import { UserContext } from '@/models/ai.types';

export interface IContextService {
  getUserContext(userId: string): Promise<UserContext>;
  updateUserContext(userId: string, context: Partial<UserContext>): Promise<void>;
}

export class ContextService implements IContextService {
  async getUserContext(userId: string): Promise<UserContext> {
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId)
      });

      if (!user) {
        throw new AppError(404, 'User not found');
      }

      // TODO: Add more context from other tables (goals, preferences, etc.)
      return {
        userId: user.id,
        // Add more fields as we implement them
      };
    } catch (error) {
      console.error('Error getting user context:', error);
      throw new AppError(500, 'Failed to get user context');
    }
  }

  async updateUserContext(userId: string, context: Partial<UserContext>): Promise<void> {
    try {
      // TODO: Implement context update logic
      // This will need to update multiple tables based on the context
      console.log('Updating context for user:', userId, context);
    } catch (error) {
      console.error('Error updating user context:', error);
      throw new AppError(500, 'Failed to update user context');
    }
  }
} 