import { db } from './db';
import * as schema from './schema';

async function checkDatabase() {
  try {
    console.log('Checking database connection...');
    
    // Check if we can connect
    const result = await db.query.users.findFirst();
    console.log('Connection successful');
    console.log('First user:', result);

    // Check all tables
    console.log('\nChecking tables:');
    const tables = [
      { name: 'users', table: schema.users },
      { name: 'user_accounts', table: schema.userAccounts },
      { name: 'user_metrics', table: schema.userMetrics },
      { name: 'workouts', table: schema.workouts },
      { name: 'workout_exercises', table: schema.workoutExercises },
      { name: 'exercise_logs', table: schema.exerciseLogs },
      { name: 'ai_sessions', table: schema.aiSessions },
      { name: 'coach_settings', table: schema.coachSettings },
      { name: 'user_memories', table: schema.userMemories },
      { name: 'training_context', table: schema.trainingContext },
      { name: 'exercises', table: schema.exercises }
    ];

    for (const { name, table } of tables) {
      try {
        const count = await db.select().from(table).limit(1);
        console.log(`${name}: ${count.length} records`);
      } catch (error: any) {
        console.log(`${name}: Error - ${error.message}`);
      }
    }

  } catch (error) {
    console.error('Database check failed:', error);
    process.exit(1);
  }
}

checkDatabase(); 