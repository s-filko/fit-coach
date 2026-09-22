CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"call_index" integer NOT NULL,
	"model" text NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"latency_ms" integer NOT NULL,
	"error_class" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_blobs" (
	"hash" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
