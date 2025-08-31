/**
 * AIContextService is responsible for:
 * 1. Processing user messages and determining their type
 * 2. Gathering additional context based on message type
 * 3. Coordinating with LLM service for response generation
 * 4. Maintaining conversation history
 * 5. Enriching user context with AI-specific data
 */

import { LLMService } from '@ai/llm.service';
import { AppError } from '@middleware/error';
import { users, trainingContext } from '@db/schema';
import type { InferSelectModel } from 'drizzle-orm';
import { LLMResponse, UserContext } from "@models/ai.types";
import { TrainingContextDbService } from "@db/services/training-context-db.service";
import { Injectable, Inject } from '@services/di/injectable';

type User = InferSelectModel<typeof users>;
type TrainingContext = InferSelectModel<typeof trainingContext>;

export interface ProcessedContext {
  type: 'workout' | 'nutrition' | 'progress' | 'general';
  context: UserContext;
  message: string;
}

@Injectable()
export class AIContextService {
  constructor(
    @Inject('LLMService') private llmService: LLMService,
    @Inject('TrainingContextDbService') private trainingContextDbService: TrainingContextDbService
  ) {}

  async processMessage(userId: string, message: string): Promise<LLMResponse> {
    try {
      const trainingContext = await this.trainingContextDbService.getTrainingContext(userId);
      const userContext: UserContext = {
        userId,
        fitnessLevel: trainingContext?.strengthLevel || undefined,
        goals: trainingContext?.primaryGoal ? [trainingContext.primaryGoal] : undefined,
        limitations: trainingContext?.recoveryStatus ? [trainingContext.recoveryStatus] : undefined,
        preferences: {
          workoutDuration: trainingContext?.timelineMonths ? trainingContext.timelineMonths * 30 : undefined,
          availableEquipment: Array.isArray(trainingContext?.targetAreas) ? trainingContext.targetAreas : undefined,
          preferredWorkoutTime: 'morning' // default value
        },
        recentProgress: trainingContext?.recentProgress as UserContext['recentProgress']
      };
      const processedContext = await this.processContext(userId, message, userContext);
      return await this.llmService.generateResponse(processedContext.message, processedContext.context);
    } catch (error) {
      console.error('Error processing message:', error);
      throw new AppError(500, 'Failed to process message');
    }
  }

  private async processContext(userId: string, message: string, userContext: UserContext): Promise<ProcessedContext> {
    const type = this.detectMessageType(message);
    const additionalContext = await this.getAdditionalContext(userId, type);

    return {
      type,
      context: {
        ...userContext,
        ...additionalContext
      },
      message
    };
  }

  private detectMessageType(message: string): ProcessedContext['type'] {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('workout') || lowerMessage.includes('exercise') || lowerMessage.includes('training')) {
      return 'workout';
    }
    
    if (lowerMessage.includes('nutrition') || lowerMessage.includes('diet') || lowerMessage.includes('food')) {
      return 'nutrition';
    }
    
    if (lowerMessage.includes('progress') || lowerMessage.includes('results') || lowerMessage.includes('achievement')) {
      return 'progress';
    }
    
    return 'general';
  }

  private async getAdditionalContext(userId: string, type: ProcessedContext['type']): Promise<Partial<UserContext>> {
    // TODO: Implement context gathering based on message type
    return {};
  }

  async getConversationHistory(userId: string, limit?: number): Promise<any[]> {
    try {
      return await this.llmService.getConversationHistory(userId, limit);
    } catch (error) {
      console.error('Error getting conversation history:', error);
      throw new AppError(500, 'Failed to get conversation history');
    }
  }
} 