-- Add 'session_planning' to conversation_phase enum
ALTER TYPE "conversation_phase" ADD VALUE IF NOT EXISTS 'session_planning';
