import { z } from 'zod';

/**
 * Set data — single source of truth. The Zod schemas define the shape; the
 * TypeScript type is inferred from them (`SetData` in types.ts), so the pair
 * cannot drift (third-run review, 2026-09-12: the former hand-written twin
 * had already drifted once over inclinePct).
 */
const setDataTypes = {
  strength: 'strength',
  cardioDistance: 'cardio_distance',
  cardioDuration: 'cardio_duration',
  functionalReps: 'functional_reps',
  isometric: 'isometric',
  interval: 'interval',
} as const;

// --- Per-type schemas (internal: consumed only by SetDataSchema) ---

const StrengthSetDataSchema = z.object({
  type: z.literal(setDataTypes.strength),
  reps: z.number().int().min(1),
  weight: z.number().min(0).optional(),
  weightUnit: z.enum(['kg', 'lbs']).optional(),
  restSeconds: z.number().int().min(0).optional(),
});

const CardioDistanceSetDataSchema = z.object({
  type: z.literal(setDataTypes.cardioDistance),
  distance: z.number().min(0),
  distanceUnit: z.enum(['km', 'miles', 'meters']),
  duration: z.number().int().min(0),
  inclinePct: z.number().min(0).max(30).optional(),
  pace: z.number().min(0).optional(),
  restSeconds: z.number().int().min(0).optional(),
});

const CardioDurationSetDataSchema = z.object({
  type: z.literal(setDataTypes.cardioDuration),
  duration: z.number().int().min(0),
  intensity: z.enum(['low', 'moderate', 'high']).optional(),
  restSeconds: z.number().int().min(0).optional(),
});

const FunctionalRepsSetDataSchema = z.object({
  type: z.literal(setDataTypes.functionalReps),
  reps: z.number().int().min(1),
  restSeconds: z.number().int().min(0).optional(),
});

const IsometricSetDataSchema = z.object({
  type: z.literal(setDataTypes.isometric),
  duration: z.number().int().min(0),
  restSeconds: z.number().int().min(0).optional(),
});

const IntervalSetDataSchema = z.object({
  type: z.literal(setDataTypes.interval),
  workDuration: z.number().int().min(0),
  restDuration: z.number().int().min(0),
  rounds: z.number().int().min(1).optional(),
});

export const SetDataSchema = z.discriminatedUnion('type', [
  StrengthSetDataSchema,
  CardioDistanceSetDataSchema,
  CardioDurationSetDataSchema,
  FunctionalRepsSetDataSchema,
  IsometricSetDataSchema,
  IntervalSetDataSchema,
]);
