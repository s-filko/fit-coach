import { z } from 'zod';

/**
 * Set data type constants — single source of truth for setData.type values.
 * Used in: Zod schemas, system prompts, LangChain tool definitions.
 */
export const setDataTypes = {
  strength: 'strength',
  cardioDistance: 'cardio_distance',
  cardioDuration: 'cardio_duration',
  functionalReps: 'functional_reps',
  isometric: 'isometric',
  interval: 'interval',
} as const;

export type SetDataType = (typeof setDataTypes)[keyof typeof setDataTypes];

export const setDataTypeValues: SetDataType[] = Object.values(setDataTypes);

// --- Per-type schemas ---

export const StrengthSetDataSchema = z.object({
  type: z.literal(setDataTypes.strength),
  reps: z.number().int().min(1),
  weight: z.number().min(0).optional(),
  weightUnit: z.enum(['kg', 'lbs']).optional(),
  restSeconds: z.number().int().min(0).optional(),
});

export const CardioDistanceSetDataSchema = z.object({
  type: z.literal(setDataTypes.cardioDistance),
  distance: z.number().min(0),
  distanceUnit: z.enum(['km', 'miles', 'meters']),
  duration: z.number().int().min(0),
  pace: z.number().min(0).optional(),
  restSeconds: z.number().int().min(0).optional(),
});

export const CardioDurationSetDataSchema = z.object({
  type: z.literal(setDataTypes.cardioDuration),
  duration: z.number().int().min(0),
  intensity: z.enum(['low', 'moderate', 'high']).optional(),
  restSeconds: z.number().int().min(0).optional(),
});

export const FunctionalRepsSetDataSchema = z.object({
  type: z.literal(setDataTypes.functionalReps),
  reps: z.number().int().min(1),
  restSeconds: z.number().int().min(0).optional(),
});

export const IsometricSetDataSchema = z.object({
  type: z.literal(setDataTypes.isometric),
  duration: z.number().int().min(0),
  restSeconds: z.number().int().min(0).optional(),
});

export const IntervalSetDataSchema = z.object({
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

export type SetDataInput = z.infer<typeof SetDataSchema>;
