-- Add 'plan_creation' to conversation_phase enum if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'plan_creation' 
    AND enumtypid = 'public.conversation_phase'::regtype
  ) THEN
    ALTER TYPE "public"."conversation_phase" ADD VALUE 'plan_creation' BEFORE 'session_planning';
  END IF;
END$$;