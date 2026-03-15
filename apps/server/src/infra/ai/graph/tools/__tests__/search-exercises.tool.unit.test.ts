import type { RunnableConfig } from '@langchain/core/runnables';

import type { IEmbeddingService, IExerciseRepository } from '@domain/training/ports';
import type { ExerciseWithMuscles } from '@domain/training/types';

import { buildSearchExercisesTool } from '../search-exercises.tool';

type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

const makeExerciseWithMuscles = (overrides: Partial<ExerciseWithMuscles> = {}): ExerciseWithMuscles => ({
  id: 1,
  name: 'Barbell Bench Press',
  category: 'compound',
  equipment: 'barbell',
  exerciseType: 'strength',
  description: 'Classic chest press',
  energyCost: 'high',
  complexity: 'intermediate',
  typicalDurationMinutes: 12,
  requiresSpotter: true,
  imageUrl: null,
  videoUrl: null,
  createdAt: new Date(),
  muscleGroups: [
    { muscleGroup: 'chest', involvement: 'primary' },
    { muscleGroup: 'triceps', involvement: 'secondary' },
  ],
  ...overrides,
});

const makeEmbeddingService = (): jest.Mocked<IEmbeddingService> => ({
  embed: jest.fn().mockResolvedValue(new Array(384).fill(0.1)),
  embedBatch: jest.fn().mockResolvedValue([]),
});

const makeExerciseRepository = (): jest.Mocked<IExerciseRepository> =>
  ({
    searchByEmbedding: jest.fn().mockResolvedValue([makeExerciseWithMuscles()]),
    findByIds: jest.fn().mockResolvedValue([]),
    updateEmbedding: jest.fn(),
    findAll: jest.fn(),
    findAllWithMuscles: jest.fn(),
    findById: jest.fn(),
    findByIdWithMuscles: jest.fn(),
    findByIdsWithMuscles: jest.fn(),
    findByMuscleGroup: jest.fn(),
    search: jest.fn(),
  }) as unknown as jest.Mocked<IExerciseRepository>;

describe('search_exercises tool', () => {
  it('has correct name', () => {
    const tool = buildSearchExercisesTool({
      embeddingService: makeEmbeddingService(),
      exerciseRepository: makeExerciseRepository(),
    }) as unknown as InvokableTool;
    expect(tool.name).toBe('search_exercises');
  });

  it('calls embeddingService.embed with the query', async () => {
    const embeddingService = makeEmbeddingService();
    const tool = buildSearchExercisesTool({
      embeddingService,
      exerciseRepository: makeExerciseRepository(),
    }) as unknown as InvokableTool;

    await tool.invoke({ query: 'chest compound barbell' });

    expect(embeddingService.embed).toHaveBeenCalledWith('chest compound barbell');
  });

  it('calls exerciseRepository.searchByEmbedding with the embedding vector', async () => {
    const embeddingService = makeEmbeddingService();
    const exerciseRepository = makeExerciseRepository();
    const vector = new Array(384).fill(0.1);
    embeddingService.embed.mockResolvedValue(vector);

    const tool = buildSearchExercisesTool({ embeddingService, exerciseRepository }) as unknown as InvokableTool;

    await tool.invoke({ query: 'chest press', limit: 5 });

    expect(exerciseRepository.searchByEmbedding).toHaveBeenCalledWith(
      vector,
      expect.objectContaining({ limit: 5 }),
    );
  });

  it('passes category filter to searchByEmbedding', async () => {
    const exerciseRepository = makeExerciseRepository();
    const tool = buildSearchExercisesTool({
      embeddingService: makeEmbeddingService(),
      exerciseRepository,
    }) as unknown as InvokableTool;

    await tool.invoke({ query: 'chest', category: 'compound' });

    expect(exerciseRepository.searchByEmbedding).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ filters: expect.objectContaining({ category: 'compound' }) }),
    );
  });

  it('passes equipment filter to searchByEmbedding', async () => {
    const exerciseRepository = makeExerciseRepository();
    const tool = buildSearchExercisesTool({
      embeddingService: makeEmbeddingService(),
      exerciseRepository,
    }) as unknown as InvokableTool;

    await tool.invoke({ query: 'press', equipment: 'barbell' });

    expect(exerciseRepository.searchByEmbedding).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ filters: expect.objectContaining({ equipment: 'barbell' }) }),
    );
  });

  it('returns exercise list as string with IDs and muscle groups', async () => {
    const exerciseRepository = makeExerciseRepository();
    exerciseRepository.searchByEmbedding.mockResolvedValue([makeExerciseWithMuscles()]);

    const tool = buildSearchExercisesTool({
      embeddingService: makeEmbeddingService(),
      exerciseRepository,
    }) as unknown as InvokableTool;

    const result = await tool.invoke({ query: 'bench press' }) as string;

    expect(result).toContain('ID:1');
    expect(result).toContain('Barbell Bench Press');
    expect(result).toContain('chest');
  });

  it('returns "no exercises found" message when results are empty', async () => {
    const exerciseRepository = makeExerciseRepository();
    exerciseRepository.searchByEmbedding.mockResolvedValue([]);

    const tool = buildSearchExercisesTool({
      embeddingService: makeEmbeddingService(),
      exerciseRepository,
    }) as unknown as InvokableTool;

    const result = await tool.invoke({ query: 'nonexistent' }) as string;

    expect(result).toContain('No exercises found');
  });

  it('returns error string when embeddingService.embed throws', async () => {
    const embeddingService = makeEmbeddingService();
    embeddingService.embed.mockRejectedValue(new Error('Model not loaded'));

    const tool = buildSearchExercisesTool({
      embeddingService,
      exerciseRepository: makeExerciseRepository(),
    }) as unknown as InvokableTool;

    const result = await tool.invoke({ query: 'chest' }) as string;

    expect(result).toContain('Error searching exercises');
    expect(result).toContain('Model not loaded');
  });
});
