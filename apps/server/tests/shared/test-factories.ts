/**
 * Shared Test Factories
 * Standardized factories for generating unique test data across all test types
 * Follows TESTING.md guidelines for unique data generation
 */

/**
 * Generates unique identifier for test data
 */
export const generateUniqueId = (prefix: string = 'test'): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `${prefix}_${timestamp}_${random}`;
};

/**
 * Generates unique user ID for test data
 */
export const generateTestUserId = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `user_${timestamp}_${random}`;
};

/**
 * Generates unique user data for testing
 */
export const createTestUserData = (overrides: Partial<{
  provider: string;
  providerUserId: string;
  username: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}> = {}) => ({
  provider: overrides.provider ?? 'telegram',
  providerUserId: overrides.providerUserId ?? generateUniqueId('user'),
  username: overrides.username ?? generateUniqueId('username'),
  firstName: overrides.firstName,
  lastName: overrides.lastName,
  languageCode: overrides.languageCode ?? 'en',
});

/**
 * Generates unique chat message payload
 */
export const createTestChatPayload = (overrides: Partial<{
  userId: string;
  message: string;
}> = {}) => ({
  userId: overrides.userId ?? generateUniqueId('user'),
  message: overrides.message ?? `Test message ${generateUniqueId()}`,
});

/**
 * Generates unique user profile data
 */
export const createTestUserProfile = (overrides: Partial<{
  age?: number;
  gender?: 'male' | 'female' | 'other';
  height?: number;
  weight?: number;
  fitnessLevel?: 'beginner' | 'intermediate' | 'advanced';
  fitnessGoal?: string;
}> = {}) => ({
  age: overrides.age ?? 25,
  gender: overrides.gender ?? 'male',
  height: overrides.height ?? 175,
  weight: overrides.weight ?? 75,
  fitnessLevel: overrides.fitnessLevel ?? 'intermediate',
  fitnessGoal: overrides.fitnessGoal ?? 'lose weight',
});

/**
 * Generates unique workout data
 */
export const createTestWorkoutData = (overrides: Partial<{
  userId: string;
  name?: string;
  notes?: string;
}> = {}) => ({
  userId: overrides.userId ?? generateUniqueId('user'),
  name: overrides.name ?? `Test Workout ${generateUniqueId()}`,
  notes: overrides.notes,
});

/**
 * Generates unique exercise data
 */
export const createTestExerciseData = (overrides: Partial<{
  name?: string;
  category?: string;
  description?: string;
  isGlobal?: boolean;
  createdBy?: string;
}> = {}) => ({
  name: overrides.name ?? `Test Exercise ${generateUniqueId()}`,
  category: overrides.category ?? 'strength',
  description: overrides.description ?? 'Test exercise description',
  isGlobal: overrides.isGlobal ?? true,
  createdBy: overrides.createdBy,
});

/**
 * Generates unique exercise log data
 */
export const createTestExerciseLogData = (overrides: Partial<{
  userId: string;
  exerciseId: string;
  sets?: number;
  reps?: number;
  weight?: number;
  comment?: string;
}> = {}) => ({
  userId: overrides.userId ?? generateUniqueId('user'),
  exerciseId: overrides.exerciseId ?? generateUniqueId('exercise'),
  sets: overrides.sets ?? 3,
  reps: overrides.reps ?? 10,
  weight: overrides.weight ?? 50,
  comment: overrides.comment,
});

/**
 * Generates unique AI session data
 */
export const createTestAiSessionData = (overrides: Partial<{
  userId: string;
  sessionType?: string;
  summary?: string;
}> = {}) => ({
  userId: overrides.userId ?? generateUniqueId('user'),
  sessionType: overrides.sessionType ?? 'chat',
  summary: overrides.summary ?? `Test session summary ${generateUniqueId()}`,
});

/**
 * Generates unique user metrics data
 */
export const createTestUserMetricsData = (overrides: Partial<{
  userId: string;
  weight?: number;
  chest?: number;
  waist?: number;
  hips?: number;
  biceps?: number;
  thigh?: number;
}> = {}) => ({
  userId: overrides.userId ?? generateUniqueId('user'),
  weight: overrides.weight ?? 75.5,
  chest: overrides.chest ?? 95,
  waist: overrides.waist ?? 80,
  hips: overrides.hips ?? 90,
  biceps: overrides.biceps ?? 30,
  thigh: overrides.thigh ?? 55,
});

/**
 * Generates test API key (from environment)
 */
export const createTestApiKey = (): string => {
  const key = process.env.BOT_API_KEY;
  if (!key) {
    throw new Error('BOT_API_KEY environment variable is not set');
  }
  return key;
};

/**
 * Generates test headers with API key
 */
export const createTestHeaders = (overrides: Record<string, string> = {}) => ({
  'x-api-key': createTestApiKey(),
  ...overrides,
});

/**
 * Generates test request options for Fastify inject
 */
export const createTestRequest = (overrides: Partial<{
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  payload?: any;
}> = {}) => ({
  method: overrides.method ?? 'GET',
  url: overrides.url ?? '/',
  headers: overrides.headers ?? createTestHeaders(),
  payload: overrides.payload,
});

/**
 * Utility to create multiple test items
 */
export const createMultipleTestItems = <T>(
  factory: (overrides?: Partial<T>) => T,
  count: number,
  overrides: Partial<T>[] = [],
): T[] => {
  return Array.from({ length: count }, (_, index) => {
    const itemOverrides = overrides[index] ?? {};
    return factory(itemOverrides);
  });
};

/**
 * Utility to create test data with timestamps
 */
export const createTestTimestamp = (): string => {
  return new Date().toISOString();
};

/**
 * Utility to create test data with future/past dates
 */
export const createTestDate = (offsetDays: number = 0): string => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString();
};

/**
 * Generates test User object (for business logic tests)
 */
export const createTestUser = (overrides: Partial<{
  id: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
  profileStatus?: string | null;
  fitnessLevel?: string | null;
  age?: number | null;
  gender?: 'male' | 'female' | null;
  height?: number | null;
  weight?: number | null;
  fitnessGoal?: string | null;
}> = {}): {
  id: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
  profileStatus?: string | null;
  fitnessLevel?: string | null;
  age?: number | null;
  gender?: 'male' | 'female' | null;
  height?: number | null;
  weight?: number | null;
  fitnessGoal?: string | null;
} => ({
  id: overrides.id ?? generateTestUserId(),
  username: overrides.username !== undefined ? overrides.username : `testuser_${generateUniqueId()}`,
  firstName: overrides.firstName !== undefined ? overrides.firstName : 'Test',
  lastName: overrides.lastName !== undefined ? overrides.lastName : 'User',
  languageCode: overrides.languageCode !== undefined ? overrides.languageCode : 'en',
  profileStatus: overrides.profileStatus !== undefined ? overrides.profileStatus : 'incomplete',
  fitnessLevel: overrides.fitnessLevel !== undefined ? overrides.fitnessLevel : null,
  age: overrides.age !== undefined ? overrides.age : null,
  gender: overrides.gender !== undefined ? overrides.gender : null,
  height: overrides.height !== undefined ? overrides.height : null,
  weight: overrides.weight !== undefined ? overrides.weight : null,
  fitnessGoal: overrides.fitnessGoal !== undefined ? overrides.fitnessGoal : null,
});
