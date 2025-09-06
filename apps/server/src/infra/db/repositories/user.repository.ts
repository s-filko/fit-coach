import { CreateUserInput, User, UserRepository } from '@domain/user/services/user.service';
import { eq, and } from 'drizzle-orm';
import type { users } from '@infra/db/schema';

type UserRow = typeof users.$inferSelect;

/**
 * Helper function to safely convert gender to the expected type
 */
function safeGenderCast(gender: string | null): 'male' | 'female' | null {
  if (!gender) {return null;}
  return gender === 'male' || gender === 'female' ? gender : null;
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
    profileStatus: row.profileStatus ?? 'incomplete',
    fitnessLevel: row.fitnessLevel ?? null,
    age: row.age ?? null,
    gender: safeGenderCast(row.gender),
    height: row.height ?? null,
    weight: row.weight ?? null,
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
    name: null,
    email: null,
    gender: null,
    height: null,
    heightUnit: null,
    weight: null,
    weightUnit: null,
    birthYear: null,
    age: null,
    fitnessGoal: null,
    tone: null,
    // Set default values
    reminderEnabled: false,
    profileStatus: 'incomplete',
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
function createUpdateData(updates: Partial<User>): Record<string, any> {
  const updateData: Record<string, any> = {
    updatedAt: new Date(),
  };

  const updateableFields: (keyof User)[] = [
    'profileStatus', 'fitnessLevel', 'age', 'gender',
    'height', 'weight', 'fitnessGoal',
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
      .where(and(
        eq(userAccounts.provider, provider),
        eq(userAccounts.providerUserId, providerUserId),
      ))
      .limit(1);

    if (!accountRows[0]) {return null;}

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, accountRows[0].userId))
      .limit(1);

    if (!userRows[0]) {return null;}

    return mapRowToUser(userRows[0]);
  }

  async create(data: CreateUserInput): Promise<User> {
    const { db, users, userAccounts } = await getDbAndSchema();

    const userData = createUserData(data);

    const [insertedUser] = await db
      .insert(users)
      .values(userData)
      .returning({ id: users.id });

    await db
      .insert(userAccounts)
      .values({
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
      profileStatus: 'incomplete',
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

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!rows[0]) {return null;}

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

    const result = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();

    if (result.length === 0) {return null;}

    return mapRowToUser(result[0]);
  }
}

