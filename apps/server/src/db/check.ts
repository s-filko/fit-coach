import { db } from '../infra/db/drizzle';
import { users } from '../infra/db/schema';
import { eq } from 'drizzle-orm';

async function checkUser() {
  try {
    // Check specific user
    const userId = 'f375a287-99e5-4516-8c8c-a5059a056cc4';
    const user = await db.select().from(users).where(eq(users.id, userId));

    console.log('User data:', user);

    // Check all users
    const allUsers = await db.select().from(users);
    console.log('All users count:', allUsers.length);
  } catch (error) {
    console.error('Database check error:', error);
  }
}

checkUser();
