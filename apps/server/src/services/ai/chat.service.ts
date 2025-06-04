import { db } from '@db/db';
import { aiSessions, users } from '@db/schema';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { AppError } from '@middleware/error';
import { getCoachReply } from './llm.service';
import { getUserByProvider } from '../userAccount.service';

type User = InferSelectModel<typeof users>;
type AISession = InferSelectModel<typeof aiSessions>;
type NewAISession = InferInsertModel<typeof aiSessions>;

export interface MessageDto {
  provider: string;
  providerUserId: string;
  content: string;
}

export class AIService {
  async processMessage(data: MessageDto): Promise<string> {
    try {
      // Get user info by provider
      const user = await getUserByProvider(data.provider, data.providerUserId);

      if (!user) {
        throw new AppError(404, 'User not found');
      }

      // Generate personalized response
      const response = await getCoachReply(data.content);

      // Save session info
      await db.insert(aiSessions).values({
        userId: user.id,
        sessionType: 'chat',
        summary: data.content,
        startedAt: new Date(),
        endedAt: new Date()
      });

      return response;
    } catch (error) {
      console.error('Error processing message:', error);
      throw new AppError(500, 'Failed to process message');
    }
  }

  private generateResponse(message: string, user: User): string {
    const greeting = user.firstName ? `Привет, ${user.firstName}!` : 'Привет!';
    
    // Simple response logic - can be enhanced with AI later
    if (message.toLowerCase().includes('привет') || message.toLowerCase().includes('здравствуй')) {
      return `${greeting} Я твой персональный фитнес-тренер. Чем могу помочь?`;
    }

    if (message.toLowerCase().includes('тренировка') || message.toLowerCase().includes('упражнение')) {
      return `${greeting} Я могу помочь составить программу тренировок. Расскажи, какие у тебя цели?`;
    }

    if (message.toLowerCase().includes('питание') || message.toLowerCase().includes('диета')) {
      return `${greeting} Правильное питание - важная часть тренировок. Хочешь обсудить твой рацион?`;
    }

    return `${greeting} Я получил твое сообщение: "${message}". Расскажи подробнее, и я помогу тебе достичь твоих фитнес-целей!`;
  }
} 