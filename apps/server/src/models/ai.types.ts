/**
 * User context for AI interactions
 */
export interface UserContext {
  userId: string;
  fitnessLevel?: string;
  goals?: string[];
  limitations?: string[];
  preferences?: {
    workoutDuration?: number;
    availableEquipment?: string[];
    preferredWorkoutTime?: string;
  };
  recentProgress?: {
    lastWorkout?: Date;
    weight?: number;
    measurements?: Record<string, number>;
  };
}

/**
 * AI Session information
 */
export interface Session {
  id: string;
  userId: string;
  type: 'chat' | 'workout' | 'nutrition';
  summary: string;
  startedAt: Date;
  endedAt: Date | null;
  metadata?: Record<string, any>;
}

/**
 * LLM Response with additional metadata
 */
export interface LLMResponse {
  content: string;
  type: 'workout' | 'nutrition' | 'general';
  confidence: number;
  suggestedActions?: string[];
  metadata?: Record<string, any>;
} 