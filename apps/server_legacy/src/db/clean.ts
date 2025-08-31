import { db } from './db';
import * as schema from './schema';

async function cleanDatabase() {
  try {
    console.log('Cleaning database...');
    
    // Order matters due to foreign keys
    await db.delete(schema.workoutExercises).catch(() => console.log('Table workoutExercises does not exist'));
    await db.delete(schema.exerciseLogs).catch(() => console.log('Table exerciseLogs does not exist'));
    await db.delete(schema.workouts).catch(() => console.log('Table workouts does not exist'));
    await db.delete(schema.userMetrics).catch(() => console.log('Table userMetrics does not exist'));
    await db.delete(schema.userAccounts).catch(() => console.log('Table userAccounts does not exist'));
    await db.delete(schema.aiSessions).catch(() => console.log('Table aiSessions does not exist'));
    await db.delete(schema.coachSettings).catch(() => console.log('Table coachSettings does not exist'));
    await db.delete(schema.userMemories).catch(() => console.log('Table userMemories does not exist'));
    await db.delete(schema.trainingContext).catch(() => console.log('Table trainingContext does not exist'));
    await db.delete(schema.exercises).catch(() => console.log('Table exercises does not exist'));
    await db.delete(schema.users).catch(() => console.log('Table users does not exist'));
    
    console.log('Database cleaned successfully');
  } catch (error) {
    console.error('Error cleaning database:', error);
    process.exit(1);
  }
}

cleanDatabase(); 