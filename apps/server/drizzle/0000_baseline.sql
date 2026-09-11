CREATE TYPE "public"."conversation_phase" AS ENUM('registration', 'chat', 'plan_creation', 'session_planning', 'training');--> statement-breakpoint
CREATE TYPE "public"."conversation_role" AS ENUM('user', 'assistant', 'system', 'summary');--> statement-breakpoint
CREATE TYPE "public"."exercise_type" AS ENUM('strength', 'cardio_distance', 'cardio_duration', 'functional_reps', 'isometric', 'interval');--> statement-breakpoint
CREATE TYPE "public"."muscle_group" AS ENUM('chest', 'back_lats', 'back_traps', 'shoulders_front', 'shoulders_side', 'shoulders_rear', 'quads', 'hamstrings', 'glutes', 'calves', 'biceps', 'triceps', 'forearms', 'abs', 'lower_back', 'core', 'cardio_system', 'full_body', 'lower_body_endurance', 'core_stability');--> statement-breakpoint
CREATE TYPE "public"."session_exercise_status" AS ENUM('pending', 'in_progress', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('planning', 'in_progress', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."workout_plan_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phase" "conversation_phase" NOT NULL,
	"role" "conversation_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_muscle_groups" (
	"exercise_id" integer NOT NULL,
	"muscle_group" "muscle_group" NOT NULL,
	"involvement" text NOT NULL,
	CONSTRAINT "exercise_muscle_groups_exercise_id_muscle_group_pk" PRIMARY KEY("exercise_id","muscle_group")
);
--> statement-breakpoint
CREATE SEQUENCE "exercises_id_seq"
	AS integer
	START WITH 1
	INCREMENT BY 1
	NO MINVALUE
	NO MAXVALUE
	CACHE 1;--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" integer PRIMARY KEY DEFAULT nextval('exercises_id_seq'::regclass) NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"equipment" text NOT NULL,
	"exercise_type" "exercise_type" NOT NULL,
	"description" text,
	"energy_cost" text NOT NULL,
	"complexity" text NOT NULL,
	"typical_duration_minutes" integer NOT NULL,
	"requires_spotter" boolean DEFAULT false,
	"image_url" text,
	"video_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exercises_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER SEQUENCE "exercises_id_seq" OWNED BY "exercises"."id";--> statement-breakpoint
CREATE TABLE "session_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"exercise_id" integer NOT NULL,
	"order_index" integer NOT NULL,
	"status" "session_exercise_status" DEFAULT 'pending' NOT NULL,
	"target_sets" integer,
	"target_reps" text,
	"target_weight" numeric(6, 2),
	"actual_reps_range" text,
	"user_feedback" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_exercise_id" uuid NOT NULL,
	"set_number" integer NOT NULL,
	"rpe" integer,
	"user_feedback" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"set_data" jsonb NOT NULL,
	CONSTRAINT "valid_set_data" CHECK (jsonb_typeof("session_sets"."set_data") = 'object' AND "session_sets"."set_data" ? 'type')
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_accounts_provider_provider_user_id_unique" UNIQUE("provider","provider_user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"language_code" text,
	"gender" text,
	"age" integer,
	"height" numeric(5, 1),
	"weight" numeric(5, 1),
	"fitness_goal" text,
	"fitness_level" text,
	"profile_status" text DEFAULT 'registration',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workout_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"plan_json" jsonb NOT NULL,
	"status" "workout_plan_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid,
	"session_key" text,
	"status" "session_status" DEFAULT 'planning' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration_minutes" integer,
	"user_context_json" jsonb,
	"session_plan_json" jsonb,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"auto_close_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" ADD CONSTRAINT "exercise_muscle_groups_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_sets" ADD CONSTRAINT "session_sets_session_exercise_id_session_exercises_id_fk" FOREIGN KEY ("session_exercise_id") REFERENCES "public"."session_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_plan_id_workout_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversation_turns_user_phase_created" ON "conversation_turns" USING btree ("user_id","phase","created_at");--> statement-breakpoint
CREATE INDEX "idx_exercise_muscle_groups_muscle" ON "exercise_muscle_groups" USING btree ("muscle_group");--> statement-breakpoint
CREATE INDEX "idx_exercises_category" ON "exercises" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_exercises_energy_cost" ON "exercises" USING btree ("energy_cost");--> statement-breakpoint
CREATE INDEX "idx_exercises_type" ON "exercises" USING btree ("exercise_type");--> statement-breakpoint
CREATE INDEX "idx_session_exercises_session" ON "session_exercises" USING btree ("session_id","order_index");--> statement-breakpoint
CREATE INDEX "idx_session_sets_exercise" ON "session_sets" USING btree ("session_exercise_id","set_number");--> statement-breakpoint
CREATE INDEX "idx_workout_plans_user_status" ON "workout_plans" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_workout_sessions_user_completed" ON "workout_sessions" USING btree ("user_id","completed_at");--> statement-breakpoint
CREATE INDEX "idx_workout_sessions_user_status" ON "workout_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_workout_sessions_activity" ON "workout_sessions" USING btree ("user_id","status","last_activity_at");--> statement-breakpoint
CREATE INDEX "idx_workout_sessions_abandoned" ON "workout_sessions" USING btree ("status","last_activity_at");