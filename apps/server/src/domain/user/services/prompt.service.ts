/* eslint-disable max-len */
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import {
  IPromptService,
  type PlanCreationPromptContext,
  type SessionPlanningPromptContext,
  type TrainingPromptContext,
} from '@domain/user/ports';
import { User } from '@domain/user/services/user.service';

import { buildPlanCreationPrompt } from './prompts/plan-creation.prompt';
import { buildSessionPlanningPrompt } from './prompts/session-planning.prompt';
import { buildTrainingPrompt } from './prompts/training.prompt';

export class PromptService implements IPromptService {
  // TODO: remove — registration prompt lives in infra/ai/graph/nodes/registration.node.ts
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  buildUnifiedRegistrationPrompt(_user: User): string {
    return '';
  }

  // TODO: remove — chat prompt lives in infra/ai/graph/nodes/chat.node.ts, not here
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  buildChatSystemPrompt(_user: User, _hasActivePlan: boolean, _recentSessions?: WorkoutSessionWithDetails[]): string {
    return '';
  }

  /**
   * System prompt for session planning phase
   * Includes training history, active plan, and recovery data
   */
  buildSessionPlanningPrompt(context: SessionPlanningPromptContext): string {
    return buildSessionPlanningPrompt(context);
  }

  /**
   * System prompt for plan creation phase
   * Helps user design their long-term workout plan
   */
  buildPlanCreationPrompt(context: PlanCreationPromptContext): string {
    return buildPlanCreationPrompt({
      userProfile: {
        name: context.user.firstName ?? context.user.username ?? 'User',
        age: context.user.age ?? 0,
        gender: context.user.gender ?? 'male',
        height: context.user.height ? Number(context.user.height) : 0,
        weight: context.user.weight ? Number(context.user.weight) : 0,
        fitnessLevel: context.user.fitnessLevel ?? 'beginner',
        fitnessGoal: context.user.fitnessGoal ?? 'general_fitness',
      },
      availableExercises: context.availableExercises.map(ex => ({
        id: ex.id,
        name: ex.name,
        category: ex.category,
        equipment: ex.equipment,
        primaryMuscles: [], // TODO: load from exercise_muscle_groups
        secondaryMuscles: [], // TODO: load from exercise_muscle_groups
      })),
      totalExercisesAvailable: context.totalExercisesAvailable,
    });
  }

  /**
   * System prompt for training phase
   * Includes current session state, exercise details, and progress
   */
  buildTrainingPrompt(context: TrainingPromptContext): string {
    return buildTrainingPrompt(context);
  }
}
