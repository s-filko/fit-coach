import { userAccounts, users } from '@db/schema';
import { eq, and } from 'drizzle-orm';
import { db } from "@db/db";
import { User, UserAccount, NewUser, NewUserAccount } from '@/models/user.types';

export async function createUserAccount(
    userId: string,
    providerUserId: string,
    provider: string,
    accountData: Partial<Omit<typeof userAccounts.$inferInsert, 'userId' | 'providerUserId' | 'provider'>>
): Promise<UserAccount> {
    const [account] = await db.insert(userAccounts).values({
        userId,
        providerUserId,
        provider,
        ...accountData,
    }).returning();

    return account;
}

export async function updateUserAccount(
    providerUserId: string,
    provider: string,
    accountData: Partial<Omit<typeof userAccounts.$inferInsert, 'userId' | 'providerUserId' | 'provider'>>
): Promise<UserAccount> {
    const [account] = await db
        .update(userAccounts)
        .set(accountData)
        .where(
            and(
                eq(userAccounts.providerUserId, providerUserId),
                eq(userAccounts.provider, provider)
            )
        )
        .returning();

    return account;
}

export async function getUserAccount(
    provider: string,
    providerUserId: string
): Promise<UserAccount | null> {
    const account = await db.query.userAccounts.findFirst({
        where: and(
            eq(userAccounts.provider, provider),
            eq(userAccounts.providerUserId, providerUserId)
        )
    });
    return account || null;
}

export async function getUserByProvider(provider: string, providerUserId: string): Promise<User | null> {
    try {
        const account = await getUserAccount(provider, providerUserId);

        if (!account) {
            return null;
        }

        const user = await db.query.users.findFirst({
            where: eq(users.id, account.userId)
        });

        return user || null;
    } catch (error) {
        console.error('Error getting user by provider:', error);
        throw error;
    }
}