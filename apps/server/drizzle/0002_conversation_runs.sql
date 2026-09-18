CREATE TYPE "public"."conversation_run_outcome" AS ENUM('ok', 'llm_unavailable', 'core_error', 'budget_exhausted');--> statement-breakpoint
CREATE TYPE "public"."conversation_turn_kind" AS ENUM('human', 'ai', 'tool_call', 'tool_result', 'system_note', 'summary');--> statement-breakpoint
CREATE TABLE "conversation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"phase_in" "conversation_phase" NOT NULL,
	"phase_out" "conversation_phase",
	"trigger" text DEFAULT 'user_message' NOT NULL,
	"client" text DEFAULT 'telegram' NOT NULL,
	"model" text NOT NULL,
	"prompt_versions" jsonb,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer NOT NULL,
	"tool_calls" jsonb,
	"transition" jsonb,
	"outcome" "conversation_run_outcome" NOT NULL,
	"budget_report" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "kind" "conversation_turn_kind" DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_runs" ADD CONSTRAINT "conversation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversation_runs_user_created" ON "conversation_runs" USING btree ("user_id","created_at");--> statement-breakpoint
UPDATE "conversation_turns" SET "kind" = CASE
  WHEN "role" = 'user' THEN 'human'::"conversation_turn_kind"
  WHEN "role" = 'assistant' THEN 'ai'::"conversation_turn_kind"
  WHEN "role" = 'summary' THEN 'summary'::"conversation_turn_kind"
  ELSE 'system_note'::"conversation_turn_kind"
END;
