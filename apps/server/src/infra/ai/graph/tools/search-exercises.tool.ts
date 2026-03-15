/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { IEmbeddingService, IExerciseRepository } from '@domain/training/ports';
import type { MuscleGroup } from '@domain/training/types';

import { createLogger } from '@shared/logger';

const log = createLogger('search-exercises-tool');

const MUSCLE_GROUPS: [MuscleGroup, ...MuscleGroup[]] = [
  'chest',
  'back_lats',
  'back_traps',
  'shoulders_front',
  'shoulders_side',
  'shoulders_rear',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'lower_back',
  'core',
  'cardio_system',
  'full_body',
  'lower_body_endurance',
  'core_stability',
];

const CATEGORIES = ['compound', 'isolation', 'cardio', 'functional', 'mobility'] as const;
const EQUIPMENT = ['barbell', 'dumbbell', 'bodyweight', 'machine', 'cable', 'none'] as const;

export interface SearchExercisesToolDeps {
  embeddingService: IEmbeddingService;
  exerciseRepository: IExerciseRepository;
}

const SEARCH_EXERCISES_DESCRIPTION = [
  'Search the exercise catalog using semantic (meaning-based) vector search.',
  'Use this tool whenever you need to find exercises — during plan creation, session planning, or training.',
  'The query should be a short English description of what you are looking for.',
  'Examples: "chest compound barbell press", "leg bodyweight squat beginner", "cardio low impact home".',
  'Apply filters (category, equipment, muscleGroup) when the context clearly constrains the search.',
  'You may call this tool multiple times in a single response to search for different muscle groups.',
  'Results include exercise IDs — always use these exact IDs when referencing exercises in other tools.',
].join(' ');

export function buildSearchExercisesTool(deps: SearchExercisesToolDeps) {
  const { embeddingService, exerciseRepository } = deps;

  return tool(
    async input => {
      try {
        const queryVector = await embeddingService.embed(input.query);

        const results = await exerciseRepository.searchByEmbedding(queryVector, {
          limit: input.limit ?? 10,
          filters: {
            category: input.category,
            equipment: input.equipment,
            muscleGroup: input.muscleGroup,
          },
        });

        if (results.length === 0) {
          return 'No exercises found matching the search criteria. Try a broader query or remove filters.';
        }

        const lines = results.map(ex => {
          const primary = ex.muscleGroups
            .filter(m => m.involvement === 'primary')
            .map(m => m.muscleGroup)
            .join(', ');
          const secondary = ex.muscleGroups
            .filter(m => m.involvement === 'secondary')
            .map(m => m.muscleGroup)
            .join(', ');
          const muscles = [primary && `primary: ${primary}`, secondary && `secondary: ${secondary}`]
            .filter(Boolean)
            .join(' | ');
          return [
            `ID:${ex.id}`,
            ex.name,
            ex.category,
            `equipment: ${ex.equipment}`,
            muscles,
            `complexity: ${ex.complexity}`,
          ].join(' | ');
        });

        log.debug({ query: input.query, count: results.length }, 'search_exercises completed');

        return `Found ${results.length} exercises:\n${lines.join('\n')}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err, query: input.query }, 'search_exercises failed');
        return `Error searching exercises: ${message}`;
      }
    },
    {
      name: 'search_exercises',
      description: SEARCH_EXERCISES_DESCRIPTION,
      schema: z.object({
        query: z
          .string()
          .describe('English description of the exercises you are looking for. E.g. "chest compound barbell".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Maximum number of results to return (default: 10, max: 20).'),
        category: z
          .enum(CATEGORIES)
          .optional()
          .describe('Filter by exercise category: compound, isolation, cardio, functional, mobility.'),
        equipment: z
          .enum(EQUIPMENT)
          .optional()
          .describe('Filter by required equipment: barbell, dumbbell, bodyweight, machine, cable, none.'),
        muscleGroup: z
          .enum(MUSCLE_GROUPS)
          .optional()
          .describe('Filter to exercises that involve this muscle group (primary or secondary).'),
      }),
    },
  );
}
