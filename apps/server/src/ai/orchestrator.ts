import { db } from '@db/db';
import { users, aiSessions } from '@db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '@middleware/error';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';

/**
 * System prompt that defines the AI coach's personality and capabilities
 */
const SYSTEM_PROMPT = `You are an AI fitness coach with expertise in:
- Personalized workout planning
- Nutrition advice
- Progress tracking
- Motivation and support

Your communication style should be:
- Professional but friendly
- Encouraging and positive
- Clear and concise
- Focused on user's goals and needs

Always consider:
- User's fitness level
- Available equipment
- Time constraints
- Health limitations
- Previous progress`;

interface ChainInput {
  systemPrompt: string;
  message: string;
}

/**
 * Orchestrates AI interactions by managing:
 * - User context and memory
 * - Session management
 * - LLM interactions
 * - Response generation
 */
export class AIOrchestrator {
  private model: ChatOpenAI;
  private chain: RunnableSequence;

  constructor() {
    // Initialize OpenAI model
    this.model = new ChatOpenAI({
      modelName: 'gpt-3.5-turbo',
      temperature: 0.7,
    });

    // Create processing chain
    this.chain = RunnableSequence.from([
      {
        system: (input: ChainInput) => new SystemMessage(input.systemPrompt),
        human: (input: ChainInput) => new HumanMessage(input.message),
      },
      this.model,
      new StringOutputParser(),
    ]);
  }

  /**
   * Process user message and generate appropriate response
   * @param userId User's unique identifier
   * @param message User's message text
   * @returns AI-generated response
   */
  async processMessage(userId: string, message: string): Promise<string> {
    try {
      // Get user context
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId)
      });

      if (!user) {
        throw new AppError(404, 'User not found');
      }

      // Create new session
      const [session] = await db.insert(aiSessions).values({
        userId,
        sessionType: 'chat',
        summary: message,
        startedAt: new Date(),
        endedAt: new Date()
      }).returning();

      // Get AI response using LangChain
      const response = await this.chain.invoke({
        systemPrompt: SYSTEM_PROMPT,
        message: message
      });

      // Update session with response
      await db.update(aiSessions)
        .set({ summary: `${message}\n${response}` })
        .where(eq(aiSessions.id, session.id));

      return response;
    } catch (error) {
      console.error('Error in AI orchestration:', error);
      throw new AppError(500, 'Failed to process message');
    }
  }

  /**
   * Get user's conversation history
   * @param userId User's unique identifier
   * @param limit Number of recent sessions to return
   */
  async getConversationHistory(userId: string, limit: number = 10) {
    return await db.query.aiSessions.findMany({
      where: eq(aiSessions.userId, userId),
      orderBy: (sessions, { desc }) => [desc(sessions.startedAt)],
      limit
    });
  }
} 