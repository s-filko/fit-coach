import { ParsedProfileData, User } from './services/user.service';

// Type for database row structure
type UserDbRow = {
  id: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  language_code?: string | null;
  profile_status?: string | null;
  fitness_level?: string | null;
  age?: number | null;
  gender?: string | null;
  height?: number | null;
  weight?: number | null;
  fitness_goal?: string | null;
  updated_at?: Date;
};

/**
 * Data transformation utilities for User domain
 *
 * These functions handle conversion between different data formats:
 * - Database entities ↔ Domain objects
 * - API responses ↔ Domain objects
 * - External data sources ↔ Domain objects
 */

// Convert database row to domain User object
export function dbRowToUser(dbRow: UserDbRow): User {
  return {
    id: dbRow.id,
    username: dbRow.username,
    firstName: dbRow.first_name,
    lastName: dbRow.last_name,
    languageCode: dbRow.language_code,
    profileStatus: dbRow.profile_status,
    fitnessLevel: dbRow.fitness_level,
    age: dbRow.age,
    gender: dbRow.gender as 'male' | 'female' | null | undefined,
    height: dbRow.height,
    weight: dbRow.weight,
    fitnessGoal: dbRow.fitness_goal,
  };
}

// Convert domain User object to database format
export function userToDbRow(user: Partial<User>): Partial<UserDbRow> {
  return {
    id: user.id,
    username: user.username,
    first_name: user.firstName,
    last_name: user.lastName,
    language_code: user.languageCode,
    profile_status: user.profileStatus,
    fitness_level: user.fitnessLevel,
    age: user.age,
    gender: user.gender,
    height: user.height,
    weight: user.weight,
    fitness_goal: user.fitnessGoal,
    updated_at: new Date(),
  };
}

// Merge parsed profile data into existing user
export function mergeProfileData(user: User, profileData: ParsedProfileData): User {
  return {
    ...user,
    age: profileData.age ?? user.age,
    gender: profileData.gender ?? user.gender,
    height: profileData.height ?? user.height,
    weight: profileData.weight ?? user.weight,
    fitnessLevel: profileData.fitnessLevel ?? user.fitnessLevel,
    fitnessGoal: profileData.fitnessGoal ?? user.fitnessGoal,
  };
}

// Clean user data for API response (remove sensitive fields)
export function userToApiResponse(user: User): User {
  const { ...safeUser } = user;
  // Add any field filtering logic here if needed
  return safeUser;
}

// Validate that profile is complete
export function isProfileComplete(user: User): boolean {
  return !!(
    user.age &&
    user.gender &&
    user.height &&
    user.weight &&
    user.fitnessLevel &&
    user.fitnessGoal
  );
}
