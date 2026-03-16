import type { ExerciseWithMuscles } from '@domain/training/types';

type EmbeddingInput = Pick<
  ExerciseWithMuscles,
  'name' | 'category' | 'equipment' | 'muscleGroups' | 'complexity' | 'description'
>;

/**
 * Builds a composite English text for embedding generation.
 *
 * The model (all-MiniLM-L6-v2) works best with English text.
 * Combining multiple attributes improves semantic search relevance:
 * querying "chest compound barbell" will surface Bench Press over isolation exercises.
 */
export function buildEmbeddingText(exercise: EmbeddingInput): string {
  const primaryMuscles = exercise.muscleGroups
    .filter(m => m.involvement === 'primary')
    .map(m => m.muscleGroup)
    .join(', ');

  const secondaryMuscles = exercise.muscleGroups
    .filter(m => m.involvement === 'secondary')
    .map(m => m.muscleGroup)
    .join(', ');

  const musclesPart = [
    primaryMuscles && `${primaryMuscles} (primary)`,
    secondaryMuscles && `${secondaryMuscles} (secondary)`,
  ]
    .filter(Boolean)
    .join(', ');

  const parts = [
    exercise.name,
    `Category: ${exercise.category}`,
    `Equipment: ${exercise.equipment}`,
    musclesPart && `Muscles: ${musclesPart}`,
    `Complexity: ${exercise.complexity}`,
    exercise.description ?? '',
  ].filter(Boolean);

  return parts.join('. ');
}
