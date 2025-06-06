export type TrainingGoal = 'strength' | 'muscle_gain' | 'weight_loss' | 'endurance' | 'general_fitness';
export type StrengthLevel = 'beginner' | 'intermediate' | 'advanced';
export type RecoveryStatus = 'poor' | 'average' | 'good' | 'excellent';
export type IntensityPreference = 'light' | 'moderate' | 'intense';

export interface TargetAreas {
    upper_body: number;
    lower_body: number;
    core: number;
    cardio: number;
}

export interface RecentProgress {
    exercise: string;
    improvement: string;
    date: Date;
}

export interface TrainingSchedule {
    frequency: number;
    preferred_time: string;
    max_duration: number;
}

export interface TimeLimitations {
    max_session_duration: number;
    available_days: string[];
    preferred_times: string[];
}

export interface TrainingContext {
    id: string;
    userId: string;
    primaryGoal: TrainingGoal;
    targetAreas: TargetAreas;
    timelineMonths: number;
    strengthLevel: StrengthLevel;
    recoveryStatus: RecoveryStatus;
    recentProgress: RecentProgress[];
    trainingSchedule: TrainingSchedule;
    intensityPreference: IntensityPreference;
    equipmentAvailable: string[];
    physicalLimitations: string[];
    timeLimitations: TimeLimitations;
    lastUpdated: Date;
    notes?: string;
} 