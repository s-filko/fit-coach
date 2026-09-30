CREATE TABLE "load_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"session_exercise_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"run_id" uuid,
	"scheme_id" text,
	"scheme_version" text,
	"stage" text,
	"row" text,
	"candidate" jsonb,
	"conservative" jsonb,
	"confidence" text,
	"fatigue" jsonb,
	"gap_tier" text,
	"rendered" text NOT NULL,
	"advised" jsonb,
	"outcome" jsonb,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "load_recommendations" ADD CONSTRAINT "load_recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_recommendations" ADD CONSTRAINT "load_recommendations_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_recommendations" ADD CONSTRAINT "load_recommendations_session_exercise_id_session_exercises_id_fk" FOREIGN KEY ("session_exercise_id") REFERENCES "public"."session_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_recommendations" ADD CONSTRAINT "load_recommendations_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_load_recommendations_session_exercise" ON "load_recommendations" USING btree ("session_exercise_id");--> statement-breakpoint
CREATE INDEX "idx_load_recommendations_user_created" ON "load_recommendations" USING btree ("user_id","created_at");