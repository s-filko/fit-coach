/**
 * Zero-LLM report of the `LOAD PLAN` (load-facts plan D14; v2 since load-plan Task 2): prints the same entry the
 * training block and `get_load_plan` render — the facts plus scheme, decision, recommend, conservative and
 * confidence (`--v1` for the facts only; the scheme is the profile default, as in the block), for every exercise the user performed in the last
 * 56 days, or for one exercise. Read-only, no model call — the owner compares it with their memory
 * of the workouts (live check 4). The entry is rendered by the same producer, so what is printed
 * here is what the coach sees (minus the EXERCISE HISTORY de-duplication: sets are always in full).
 *
 * Run: npm run print-load-plan -- --user <userId> [--exercise <exerciseId>] [--v1] [--env-file <path>]
 *
 * `--env-file` works as in print-transcript: the imports that open a database connection are dynamic,
 * below, so they resolve only after the override has loaded its file.
 */
import path from 'node:path';

import dotenv from 'dotenv';

const WINDOW_DAYS = 56;

function usageError(message: string): never {
  console.error(`${message}\n`);
  console.error(
    'Usage: npm run print-load-plan -- --user <userId> [--exercise <exerciseId>] [--v1] [--env-file <path>]',
  );
  process.exit(2);
}

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx === -1 ? undefined : args[idx + 1];
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const userId = argValue(args, '--user');
  const onlyExercise = argValue(args, '--exercise');
  const envFile = argValue(args, '--env-file');
  const factsOnly = args.includes('--v1');
  if (!userId) {
    usageError('--user is required');
  }
  if (envFile) {
    dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });
  }

  const [
    { pool },
    { WorkoutSessionRepository },
    { ExerciseRepository },
    { UserFactsRepository },
    { DrizzleUserRepository },
    loader,
    { renderLoadPlanEntry },
    { renderLoadPlanEntryV2 },
    { defaultProgression },
    { calendarDaysAgo },
    { formatDatabaseTarget, describeSchemaError },
  ] = await Promise.all([
    import('@infra/db/drizzle'),
    import('@infra/db/repositories/workout-session.repository'),
    import('@infra/db/repositories/exercise.repository'),
    import('@infra/db/repositories/user-facts.repository'),
    import('@infra/db/repositories/user.repository'),
    import('@infra/ai/load-facts/load-facts.loader'),
    import('@infra/ai/prompts/blocks/training-load-plan.v1'),
    import('@infra/ai/prompts/blocks/training-load-plan.v2'),
    import('@domain/training/load-plan'),
    import('@shared/date-utils'),
    import('@infra/observability/db-target'),
  ]);

  const target = {
    host: String(pool.options.host),
    port: Number(pool.options.port),
    database: String(pool.options.database),
  };
  console.log(formatDatabaseTarget(target));

  try {
    const now = new Date();
    const sessionRepo = new WorkoutSessionRepository();
    const user = await new DrizzleUserRepository().getById(userId);
    const timezone = user?.timezone ?? null;

    let exerciseIds: string[];
    if (onlyExercise) {
      exerciseIds = [onlyExercise];
    } else {
      const recent = await sessionRepo.findRecentByUserIdWithDetails(userId, loader.LOAD_FACTS_RECENT_WORKOUTS, {
        realWorkoutsOnly: true,
      });
      exerciseIds = [
        ...new Set(
          recent
            .filter(s => calendarDaysAgo(s.completedAt ?? s.createdAt, now, timezone) <= WINDOW_DAYS)
            .flatMap(s => s.exercises.filter(ex => ex.sets.length > 0).map(ex => ex.exerciseId)),
        ),
      ];
    }

    const entries = await loader.loadLoadPlanEntries(
      {
        workoutSessionRepo: sessionRepo,
        exerciseRepository: new ExerciseRepository(),
        trainingService: { getSessionDetails: id => sessionRepo.findByIdWithDetails(id) },
        userFacts: new UserFactsRepository(),
      },
      { userId, session: null, exerciseIds, planTargetReps: new Map(), now, timezone },
    );

    console.log(`\nLOAD PLAN report for ${userId} at ${now.toISOString()} (timezone: ${timezone ?? 'none'})`);
    console.log(`${entries.length} exercise(s), no LLM call.\n`);
    const progression = defaultProgression(user);
    const equipment = entries[0]?.facts.constraints.equipment ?? [];
    if (!factsOnly && equipment.length > 0) {
      console.log(`equipment facts (all exercises): ${equipment.join('; ')}\n`);
    }
    for (const entry of entries) {
      const ctx = { now, timezone, user: null };
      console.log(
        factsOnly
          ? renderLoadPlanEntry(entry, ctx, { showToday: false })
          : renderLoadPlanEntryV2(entry, ctx, { progression, showToday: false, equipment: 'omit' }),
      );
      console.log('');
    }
  } catch (err) {
    const friendly = describeSchemaError(err, target);
    if (friendly) {
      console.error(friendly);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    await pool.end();
  }
}

run().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
