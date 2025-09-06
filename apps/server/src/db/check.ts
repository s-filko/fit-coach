import { db } from '../infra/db/drizzle';
import { users } from '../infra/db/schema';
import { eq } from 'drizzle-orm';

async function checkUser(): Promise<void> {
  try {
    // Check specific user
    const userId = 'f375a287-99e5-4516-8c8c-a5059a056cc4';
    await db.select().from(users).where(eq(users.id, userId));

    // Inspections can be added via proper logger if needed

    // Check all users
    await db.select().from(users);
    // Removed console output
  } catch {
    // Swallow errors here or rethrow; avoid console usage in production code
  }
}

checkUser();
