-- plan-and-tool-fixes T7 (AC-PTF-7): the weight contract per exercise. The column above fills
-- every existing row with its default 'required' (everything else); the two UPDATEs below
-- carve out bodyweight equipment and reps-only machine movements (optional) and cardio / no-equipment (none). The same rule
-- lives in src/domain/training/weight-mode.ts (fresh databases get it from the seed).
ALTER TABLE "exercises" ADD COLUMN "weight_mode" text DEFAULT 'required' NOT NULL;--> statement-breakpoint
UPDATE "exercises" SET "weight_mode" = 'optional' WHERE "equipment" = 'bodyweight';--> statement-breakpoint
UPDATE "exercises" SET "weight_mode" = 'optional' WHERE "equipment" = 'machine' AND "exercise_type" = 'functional_reps';--> statement-breakpoint
UPDATE "exercises" SET "weight_mode" = 'none' WHERE "category" = 'cardio' OR "equipment" = 'none';--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_weight_mode_check" CHECK ("exercises"."weight_mode" in ('required', 'optional', 'none'));
