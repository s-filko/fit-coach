/**
 * LLMService is responsible for:
 * 1. Managing interactions with the OpenAI LLM model
 * 2. Generating personalized responses based on user context
 * 3. Maintaining conversation history and context
 * 4. Handling message formatting and processing
 * 5. Managing system prompts and response parsing
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { UserContext, LLMResponse } from '@models/ai.types';
import { AppError } from '@middleware/error';
import { db } from '@db/db';
import { aiSessions } from '@db/schema';
import { eq } from 'drizzle-orm';

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

export interface ILLMService {
  generateResponse(message: string, context: UserContext): Promise<LLMResponse>;
  getConversationHistory(userId: string, limit?: number): Promise<any[]>;
}

export class LLMService implements ILLMService {
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
        system: (input: { systemPrompt: string; context: UserContext; message: string }) => 
          new SystemMessage(this.buildSystemPrompt(input.systemPrompt, input.context)),
        human: (input: { systemPrompt: string; context: UserContext; message: string }) => 
          new HumanMessage(input.message),
      },
      this.model,
      new StringOutputParser(),
    ]);
  }

  private buildSystemPrompt(basePrompt: string, context: UserContext): string {
    // Add user context to the system prompt
    const contextInfo = [
      context.fitnessLevel && `Fitness Level: ${context.fitnessLevel}`,
      context.goals?.length && `Goals: ${context.goals.join(', ')}`,
      context.limitations?.length && `Limitations: ${context.limitations.join(', ')}`,
      context.preferences?.workoutDuration && `Preferred Workout Duration: ${context.preferences.workoutDuration} minutes`,
      context.preferences?.availableEquipment?.length && 
        `Available Equipment: ${context.preferences.availableEquipment.join(', ')}`,
      context.preferences?.preferredWorkoutTime && 
        `Preferred Workout Time: ${context.preferences.preferredWorkoutTime}`,
    ].filter(Boolean).join('\n');

    return `${basePrompt}\n\nUser Context:\n${contextInfo}`;
  }

  async generateResponse(message: string, context: UserContext): Promise<LLMResponse> {
    try {
      // Create new session
      const [session] = await db.insert(aiSessions).values({
        userId: context.userId,
        sessionType: 'chat',
        summary: message,
        startedAt: new Date(),
        endedAt: new Date()
      }).returning();

      // Generate response
      const response = await this.chain.invoke({
        systemPrompt: SYSTEM_PROMPT,
        context,
        message
      });

      // Update session with response
      await db.update(aiSessions)
        .set({ summary: `${message}\n${response}` })
        .where(eq(aiSessions.id, session.id));

      // TODO: Implement response type detection and confidence scoring
      return {
        content: response,
        type: 'general',
        confidence: 1.0,
        suggestedActions: []
      };
    } catch (error) {
      console.error('Error generating response:', error);
      throw new AppError(500, 'Failed to process message');
    }
  }

  /**
   * Get user's conversation history
   */
  async getConversationHistory(userId: string, limit: number = 10): Promise<any[]> {
    try {
      return await db.query.aiSessions.findMany({
        where: eq(aiSessions.userId, userId),
        orderBy: (sessions: { startedAt: any; }, {desc}: any) => [desc(sessions.startedAt)],
        limit
      });
    } catch (error) {
      console.error('Error getting conversation history:', error);
      throw new AppError(500, 'Failed to get conversation history');
    }
  }
}