-- Update session_status enum and add session_plan_json field
-- Session now stores LLM recommendation directly

-- 1. Update session_status enum: planned → planning
ALTER TYPE "session_status" RENAME VALUE 'planned' TO 'planning';

-- 2. Add session_plan_json field to workout_sessions
ALTER TABLE "workout_sessions" ADD COLUMN "session_plan_json" jsonb;

COMMENT ON COLUMN "workout_sessions"."session_plan_json" IS 'Session plan from LLM (SessionRecommendation): exercises, reasoning, duration, warnings. Updated during planning phase, read-only during training.';
