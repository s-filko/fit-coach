-- Add 'session_planning' to conversation_phase enum if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'session_planning' 
    AND enumtypid = 'public.conversation_phase'::regtype
  ) THEN
    ALTER TYPE "public"."conversation_phase" ADD VALUE 'session_planning' BEFORE 'training';
  END IF;
END$$;
--> statement-breakpoint
-- Update session_status enum (idempotent)
DO $$
BEGIN
  -- Convert status column to text temporarily
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_sessions' AND column_name = 'status'
  ) THEN
    ALTER TABLE "workout_sessions" ALTER COLUMN "status" SET DATA TYPE text;
    ALTER TABLE "workout_sessions" ALTER COLUMN "status" SET DEFAULT 'planning'::text;
    
    -- Update old 'planned' values to 'planning'
    UPDATE "workout_sessions" SET "status" = 'planning' WHERE "status" = 'planned';
  END IF;
  
  -- Drop old enum type if it exists
  DROP TYPE IF EXISTS "public"."session_status";
  
  -- Create new enum type
  CREATE TYPE "public"."session_status" AS ENUM('planning', 'in_progress', 'completed', 'skipped');
  
  -- Convert status column back to enum
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_sessions' AND column_name = 'status'
  ) THEN
    ALTER TABLE "workout_sessions" ALTER COLUMN "status" SET DEFAULT 'planning'::"public"."session_status";
    ALTER TABLE "workout_sessions" ALTER COLUMN "status" SET DATA TYPE "public"."session_status" USING "status"::"public"."session_status";
  END IF;
END$$;
--> statement-breakpoint
-- Update user columns to numeric (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'height'
  ) THEN
    ALTER TABLE "users" ALTER COLUMN "height" SET DATA TYPE numeric(5, 1);
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'weight'
  ) THEN
    ALTER TABLE "users" ALTER COLUMN "weight" SET DATA TYPE numeric(5, 1);
  END IF;
END$$;
--> statement-breakpoint
-- Add session_plan_json column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_sessions' AND column_name = 'session_plan_json'
  ) THEN
    ALTER TABLE "workout_sessions" ADD COLUMN "session_plan_json" jsonb;
  END IF;
END$$;