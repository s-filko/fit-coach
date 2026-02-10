CREATE TABLE "conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversation_turns_user_phase_created" ON "conversation_turns" USING btree ("user_id","phase","created_at");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "height_unit";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "weight_unit";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "birth_year";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "tone";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "reminder_enabled";