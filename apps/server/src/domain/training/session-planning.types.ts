import { z } from 'zod';

/**
 * Zod schema for recommended exercise in session plan
 */
export const RecommendedExerciseSchema = z.object({
  exerciseId: z.string().uuid(),
  exerciseName: z
    .string()
    .min(1)
    .optional()
    .describe('English catalog name of the exercise — must match the catalog row of exerciseId.'),
  targetSets: z.number().int().positive(),
  targetReps: z.string().min(1), // e.g., '8-10', '12-15'
  // LLM may send null, "BW", or a number — normalize to number | undefined
  targetWeight: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform(v => {
      if (v === null || v === undefined) {
        return undefined;
      }
      if (typeof v === 'string') {
        const n = parseFloat(v);
        return isNaN(n) ? undefined : n;
      }
      return v;
    }),
  restSeconds: z.number().int().positive(),
  notes: z.string().optional(),
  imageUrl: z.string().url().optional(),
  videoUrl: z.string().url().optional(),
});

/**
 * Zod schema for session recommendation (workout plan)
 */
export const SessionRecommendationSchema = z.object({
  sessionKey: z.string().min(1), // e.g., 'upper_a', 'lower_b', 'custom'
  sessionName: z.string().min(1),
  reasoning: z.string().min(1),
  exercises: z.array(RecommendedExerciseSchema).min(1),
  estimatedDuration: z.number().int().positive(), // minutes
  timeLimit: z.number().int().positive().optional(), // minutes - user's available time
  warnings: z.array(z.string()).optional(),
  modifications: z.array(z.string()).optional(),
});
