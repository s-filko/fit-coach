import { z } from 'zod';

import type { ParsedProfileData } from './user.service';

/**
 * Profile field keys — single source of truth.
 */
export type ProfileDataKey = keyof ParsedProfileData;

/**
 * Centralized field validators for registration.
 * Single source of truth: parsing and registration use the same rules.
 */
const ageSchema = z.union([z.number().int().min(10).max(100), z.null()]).transform((v) => v ?? undefined);
const genderSchema = z.union([z.enum(['male', 'female']), z.null()]).transform((v) => v ?? undefined);
const heightSchema = z.union([z.number().int().min(120).max(220), z.null()]).transform((v) => v ?? undefined);
const weightSchema = z.union([z.number().int().min(30).max(200), z.null()]).transform((v) => v ?? undefined);
const fitnessLevelSchema = z
  .union([z.enum(['beginner', 'intermediate', 'advanced']), z.null()])
  .transform((v) => v ?? undefined);
const fitnessGoalSchema = z
  .union([z.string().min(1).max(100), z.null()])
  .transform((v) => (v?.trim() ? v.trim() : undefined));

export const fieldValidators = {
  age: ageSchema,
  gender: genderSchema,
  height: heightSchema,
  weight: weightSchema,
  fitnessLevel: fitnessLevelSchema,
  fitnessGoal: fitnessGoalSchema,
} as const;

function validateWithFallback<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

/**
 * Validate a single field value. Returns validated value or undefined if invalid.
 */
export function validateField(key: ProfileDataKey, value: unknown): unknown {
  const validator = fieldValidators[key] as z.ZodType<unknown> | undefined;
  if (!validator) {return undefined;}
  return validateWithFallback(validator, value);
}

/** Human-readable field names for messages. */
export const FIELD_LABELS: Record<ProfileDataKey, string> = {
  age: 'age',
  gender: 'gender',
  height: 'height',
  weight: 'weight',
  fitnessLevel: 'fitness level',
  fitnessGoal: 'training goal',
};

/** Short validation hints for invalid fields (e.g. "age: 10–100 years"). */
export const FIELD_HINTS: Record<ProfileDataKey, string> = {
  age: '10–100 years',
  gender: 'male or female',
  height: '120–220 cm',
  weight: '30–200 kg',
  fitnessLevel: 'beginner, intermediate, or advanced',
  fitnessGoal: 'e.g. lose weight, build muscle, maintain fitness',
};

// --- Unified registration LLM response schema ---

/** Shape of the JSON response expected from LLM during registration */
export const registrationLLMResponseSchema = z.object({
  extracted_data: z.object({
    age: z.union([z.number(), z.null()]).optional(),
    gender: z.union([z.string(), z.null()]).optional(),
    height: z.union([z.number(), z.null()]).optional(),
    weight: z.union([z.number(), z.null()]).optional(),
    fitnessLevel: z.union([z.string(), z.null()]).optional(),
    fitnessGoal: z.union([z.string(), z.null()]).optional(),
  }),
  response: z.string().min(1),
  is_confirmed: z.boolean(),
});

export type RegistrationLLMResponse = z.infer<typeof registrationLLMResponseSchema>;

/**
 * Validate extracted fields from LLM using the strict field validators.
 * Only returns fields that pass validation (invalid values → undefined).
 */
export function validateExtractedFields(data: Record<string, unknown>): ParsedProfileData {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(fieldValidators)) {
    const value = data[key];
    if (value !== null && value !== undefined) {
      result[key] = validateWithFallback(fieldValidators[key as ProfileDataKey] as z.ZodType<unknown>, value);
    }
  }
  return result as ParsedProfileData;
}
