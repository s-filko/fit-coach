import { LLMService } from '@domain/ai/ports';
import type { ConversationStateType } from '@domain/conversation/graph/conversation.state';
import { parseLLMResponse } from '@domain/conversation/llm-response.types';
import type { ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IPromptService, IUserService } from '@domain/user/ports';

const RECENT_SESSIONS_LIMIT = 5;

export interface ChatNodeDeps {
  promptService: IPromptService;
  llmService: LLMService;
  trainingService: ITrainingService;
  workoutPlanRepo: IWorkoutPlanRepository;
  userService: IUserService;
}

export function buildChatNode(deps: ChatNodeDeps) {
  const { promptService, llmService, trainingService, workoutPlanRepo, userService } = deps;

  return async function chatNode(state: ConversationStateType): Promise<Partial<ConversationStateType>> {
    const { userId, messages, userMessage } = state;

    const user = await userService.getUser(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const [activePlan, recentSessions] = await Promise.all([
      workoutPlanRepo.findActiveByUserId(userId),
      trainingService.getTrainingHistory(userId, RECENT_SESSIONS_LIMIT),
    ]);

    const systemPrompt = promptService.buildChatSystemPrompt(user, !!activePlan, recentSessions);

    const llmMessages = [...messages, { role: 'user' as const, content: userMessage }];
    const rawResponse = await llmService.generateWithSystemPrompt(llmMessages, systemPrompt, { jsonMode: true });

    const { message, phaseTransition, profileUpdate } = parseLLMResponse(rawResponse);

    if (profileUpdate) {
      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(profileUpdate)) {
        if (value !== null && value !== undefined) {
          updates[key] = value;
        }
      }
      if (Object.keys(updates).length > 0) {
        await userService.updateProfileData(userId, updates);
      }
    }

    return {
      responseMessage: message,
      requestedTransition: phaseTransition
        ? { toPhase: phaseTransition.toPhase, reason: phaseTransition.reason, sessionId: phaseTransition.sessionId }
        : null,
    };
  };
}
