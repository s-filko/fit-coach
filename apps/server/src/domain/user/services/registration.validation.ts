import { z } from 'zod';

import { getStepConfig, type ProfileDataKey } from './registration.config';
import type { ParsedProfileData, User } from './user.service';

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
export function validateField<K extends ProfileDataKey>(key: K, value: unknown): ParsedProfileData[K] | undefined {
  const validator = fieldValidators[key] as z.ZodType<ParsedProfileData[K]> | undefined;
  if (!validator) {return undefined;}
  return validateWithFallback(validator, value);
}

/**
 * Validate and normalize extracted data into ParsedProfileData (invalid → undefined).
 * Used by profile parser.
 */
export function validateProfileFields(data: Record<string, unknown>): ParsedProfileData {
  const result: Record<string, unknown> = {};
  for (const [key, validator] of Object.entries(fieldValidators)) {
    result[key] = validateWithFallback(validator as z.ZodType<unknown>, data[key]);
  }
  return result as ParsedProfileData;
}

export interface StepValidationResult {
  /** Only validated values for this step's fields (use to update user). */
  validData: Partial<User>;
  /** Fields that have a value but it failed validation — ask user to correct. */
  invalidFields: ProfileDataKey[];
  /** Required fields for this step with no valid value — ask user to provide. */
  missingFields: ProfileDataKey[];
  /** True when step can be completed (all required fields valid). */
  isComplete: boolean;
}

/**
 * Validate data for a registration step: identify valid values, invalid (need correction), and missing (need input).
 * Collector uses this to decide: advance step, ask to correct invalid, or ask for missing.
 */
export function validateStepData(stepId: string, data: Partial<User>): StepValidationResult {
  const stepConfig = getStepConfig(stepId);
  const validData: Partial<User> = {};
  const invalidFields: ProfileDataKey[] = [];
  const missingFields: ProfileDataKey[] = [];

  if (!stepConfig || stepConfig.fieldsToCollect.length === 0) {
    return { validData: {}, invalidFields: [], missingFields: [], isComplete: true };
  }

  for (const key of stepConfig.fieldsToCollect) {
    const value = data[key as keyof User];
    const hasValue = value !== undefined && value !== null && value !== '';
    const validated = validateField(key, value);

    if (validated !== undefined && validated !== null && validated !== '') {
      (validData as Record<string, unknown>)[key] = validated;
    } else if (hasValue) {
      invalidFields.push(key);
      missingFields.push(key);
    } else {
      missingFields.push(key);
    }
  }

  const isComplete = stepConfig.fieldsToCollect.every((k) => {
    const v = validData[k as keyof User];
    return v !== undefined && v !== null && v !== '';
  });

  return { validData, invalidFields, missingFields, isComplete };
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
