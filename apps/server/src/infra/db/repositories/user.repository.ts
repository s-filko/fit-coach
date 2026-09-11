import { and, eq } from 'drizzle-orm';

import { UserRepository } from '@domain/user/ports';
import { CreateUserInput, User } from '@domain/user/services/user.service';

import type { users } from '@infra/db/schema';

type UserRow = typeof users.$inferSelect;

/**
 * Helper function to safely convert gender to the expected type
 */
function safeGenderCast(gender: string | null): 'male' | 'female' | null {
  if (!gender) {
    return null;
  }
  return gender === 'male' || gender === 'female' ? gender : null;
}

/**
 * Helper function to convert Drizzle numeric (string) to number
 * Drizzle returns numeric columns as strings to preserve precision
 */
function parseNumeric(value: string | number | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Helper function to map database row to User domain object
 */
function mapRowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username ?? null,
    firstName: row.firstName ?? null,
    lastName: row.lastName ?? null,
    languageCode: row.languageCode ?? null,
    timezone: row.timezone ?? null,
    profileStatus: row.profileStatus ?? 'registration',
    fitnessLevel: row.fitnessLevel ?? null,
    age: row.age ?? null,
    gender: safeGenderCast(row.gender),
    height: parseNumeric(row.height),
    weight: parseNumeric(row.weight),
    fitnessGoal: row.fitnessGoal ?? null,
  };
}

/**
 * Helper function to get database and schema imports
 */
async function getDbAndSchema() {
  const { db } = await import('@infra/db/drizzle');
  const { users, userAccounts } = await import('@infra/db/schema');
  return { db, users, userAccounts };
}

/**
 * Helper function to create user data for insertion
 */
function createUserData(input: CreateUserInput) {
  return {
    // Explicitly set nullable fields to null
    gender: null,
    age: null,
    height: null,
    weight: null,
    fitnessGoal: null,
    timezone: null,
    // Set default values
    profileStatus: 'registration',
    fitnessLevel: null,
    // Set provided values
    username: input.username ?? null,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    languageCode: input.languageCode ?? null,
  };
}

/**
 * Helper function to create update data object
 * IMPORTANT: null values are treated as explicit "clear field" requests
 */
function createUpdateData(updates: Partial<User>): Record<string, unknown> {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  const updateableFields: (keyof User)[] = [
    'firstName',
    'timezone',
    'profileStatus',
    'fitnessLevel',
    'age',
    'gender',
    'height',
    'weight',
    'fitnessGoal',
  ];

  updateableFields.forEach(field => {
    // Check if field is explicitly provided (including null values)
    if (field in updates) {
      updateData[field] = updates[field];
    }
  });

  return updateData;
}

export class DrizzleUserRepository implements UserRepository {
  async findByProvider(provider: string, providerUserId: string): Promise<User | null> {
    const { db, userAccounts, users } = await getDbAndSchema();

    const accountRows = await db
      .select()
      .from(userAccounts)
      .where(and(eq(userAccounts.provider, provider), eq(userAccounts.providerUserId, providerUserId)))
      .limit(1);

    if (!accountRows[0]) {
      return null;
    }

    const userRows = await db.select().from(users).where(eq(users.id, accountRows[0].userId)).limit(1);

    if (!userRows[0]) {
      return null;
    }

    return mapRowToUser(userRows[0]);
  }

  async create(data: CreateUserInput): Promise<User> {
    const { db, users, userAccounts } = await getDbAndSchema();

    const userData = createUserData(data);

    const [insertedUser] = await db.insert(users).values(userData).returning({ id: users.id });

    await db.insert(userAccounts).values({
      userId: insertedUser.id,
      provider: data.provider,
      providerUserId: data.providerUserId,
    });

    return {
      id: insertedUser.id,
      username: data.username ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      languageCode: data.languageCode ?? null,
      timezone: null,
      profileStatus: 'registration',
      fitnessLevel: null,
      age: null,
      gender: null,
      height: null,
      weight: null,
      fitnessGoal: null,
    };
  }

  async getById(id: string): Promise<User | null> {
    const { db, users } = await getDbAndSchema();

    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);

    if (!rows[0]) {
      return null;
    }

    return mapRowToUser(rows[0]);
  }

  async updateProfileData(id: string, data: Partial<User>): Promise<User | null> {
    const { db, users } = await getDbAndSchema();

    const updateData = createUpdateData(data);

    // Check if any profile fields are being updated (excluding updatedAt)
    const hasProfileUpdates = Object.keys(updateData).some(key => key !== 'updatedAt');

    if (!hasProfileUpdates) {
      return await this.getById(id);
    }

    const result = await db.update(users).set(updateData).where(eq(users.id, id)).returning();

    if (result.length === 0) {
      return null;
    }

    return mapRowToUser(result[0]);
  }
}
