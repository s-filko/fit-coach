export interface User {
  id: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
  profileStatus?: string | null;
  fitnessLevel?: string | null;
  // Profile data fields - allow null for clearing data
  age?: number | null;
  gender?: 'male' | 'female' | null;
  height?: number | null;
  weight?: number | null;
  fitnessGoal?: string | null;
}

export type ParsedProfileData = Pick<User, 'age' | 'gender' | 'height' | 'weight' | 'fitnessLevel' | 'fitnessGoal' >
export type ProfileDataKeys = keyof ParsedProfileData;

// export interface ParsedProfileData {
//   limitations?: string[];
//   equipment?: string[];
// }

export interface CreateUserInput {
  provider: string;
  providerUserId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}

import { IUserService, UserRepository } from '@domain/user/ports';

import { getNextStep } from './registration.config';

export class UserService implements IUserService {
  constructor(private readonly repo: UserRepository) {}

  async upsertUser(input: CreateUserInput): Promise<User> {
    const existing = await this.repo.findByProvider(input.provider, input.providerUserId);
    if (existing) {return existing;} // minimal behavior
    return this.repo.create(input);
  }

  async getUser(userId: string): Promise<User | null> {
    return this.repo.getById(userId);
  }

  async updateProfileData(userId: string, data: Partial<User>): Promise<User | null> {
    return this.repo.updateProfileData(userId, data);
  }

  // Check if registration is complete
  isRegistrationComplete(user: User): boolean {
    return user.profileStatus === 'complete';
  }

  // Check if user needs registration
  needsRegistration(user: User): boolean {
    return user.profileStatus !== 'complete';
  }

  // Get current registration step
  getCurrentRegistrationStep(user: User): string {
    return user.profileStatus ?? 'incomplete';
  }

  // Get next registration step (from centralized config)
  getNextRegistrationStep(user: User): string {
    return getNextStep(user.profileStatus) ?? 'complete';
  }
}
