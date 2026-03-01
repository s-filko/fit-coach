import { z } from 'zod';

import type { ParsedProfileData } from './user.service';

/**
 * Profile field keys — single source of truth.
 */
export type ProfileDataKey = keyof ParsedProfileData;

/**
 * Centralized field validators for registration.
 * Single source of truth: parsing and registration use the same rules.
 *
 * Note: All numeric fields accept decimal values from user input.
 * Age is rounded to nearest integer for storage.
 *
 * Validation ranges (reasonable human limits):
 * - Age: 10-120 years (children to very elderly)
 * - Height: 100-250 cm (dwarfism to very tall)
 * - Weight: 20-300 kg (underweight children to very heavy adults)
 */
const ageSchema = z
  .union([
    z
      .number()
      .min(10, 'Age must be at least 10 years')
      .max(120, 'Age must be at most 120 years')
      .transform(v => Math.round(v)), // Accept decimal, round to int
    z.null(),
  ])
  .transform(v => v ?? undefined);

const genderSchema = z.union([z.enum(['male', 'female']), z.null()]).transform(v => v ?? undefined);

const heightSchema = z
  .union([z.number().min(100, 'Height must be at least 100 cm').max(250, 'Height must be at most 250 cm'), z.null()])
  .transform(v => v ?? undefined);

const weightSchema = z
  .union([z.number().min(20, 'Weight must be at least 20 kg').max(300, 'Weight must be at most 300 kg'), z.null()])
  .transform(v => v ?? undefined);
const fitnessLevelSchema = z
  .union([z.enum(['beginner', 'intermediate', 'advanced']), z.null()])
  .transform(v => v ?? undefined);
const fitnessGoalSchema = z
  .union([z.string().min(1).max(100), z.null()])
  .transform(v => (v?.trim() ? v.trim() : undefined));

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
  if (!validator) {
    return undefined;
  }
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

/** Short validation hints for invalid fields (e.g. "age: 10–120 years"). */
export const FIELD_HINTS: Record<ProfileDataKey, string> = {
  age: '10–120 years',
  gender: 'male or female',
  height: '100–250 cm',
  weight: '20–300 kg',
  fitnessLevel: 'beginner, intermediate, or advanced',
  fitnessGoal: 'e.g. lose weight, build muscle, maintain fitness',
};

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
