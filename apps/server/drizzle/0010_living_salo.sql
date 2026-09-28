-- INV-TRAINING-002: at most one in_progress workout session per user, enforced by the database.
-- drizzle-kit cannot express a data guard, so it is hand-written here, ahead of the generated index.
-- If any user already has several in_progress sessions the migration ABORTS naming them: it never
-- deletes, completes or otherwise rewrites a session — resolving real training history is a decision
-- for a person (complete or skip all but one session per listed user), then re-run the migration.
DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(d.user_id::text || ' (' || d.n || ' in_progress sessions: ' || d.session_ids || ')', '; ' ORDER BY d.user_id)
    INTO offenders
    FROM (
      SELECT user_id, count(*) AS n, string_agg(id::text, ', ' ORDER BY created_at) AS session_ids
        FROM workout_sessions
       WHERE status = 'in_progress'
       GROUP BY user_id
      HAVING count(*) > 1
    ) d;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce INV-TRAINING-002: users with more than one in_progress workout session: %. Complete or skip all but one session per user, then re-run the migration. Nothing was changed.', offenders;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workout_sessions_one_in_progress_per_user" ON "workout_sessions" USING btree ("user_id") WHERE "workout_sessions"."status" = 'in_progress';
