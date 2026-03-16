import { buildEmbeddingText } from '../embedding-text.util';

const makeExercise = (overrides: Partial<Parameters<typeof buildEmbeddingText>[0]> = {}) => ({
  name: 'Barbell Bench Press',
  category: 'compound' as const,
  equipment: 'barbell' as const,
  complexity: 'intermediate' as const,
  description: 'Classic chest compound movement with barbell',
  muscleGroups: [
    { muscleGroup: 'chest' as const, involvement: 'primary' as const },
    { muscleGroup: 'shoulders_front' as const, involvement: 'secondary' as const },
    { muscleGroup: 'triceps' as const, involvement: 'secondary' as const },
  ],
  ...overrides,
});

describe('buildEmbeddingText', () => {
  it('includes exercise name', () => {
    const text = buildEmbeddingText(makeExercise());
    expect(text).toContain('Barbell Bench Press');
  });

  it('includes category', () => {
    const text = buildEmbeddingText(makeExercise());
    expect(text).toContain('Category: compound');
  });

  it('includes equipment', () => {
    const text = buildEmbeddingText(makeExercise());
    expect(text).toContain('Equipment: barbell');
  });

  it('includes primary muscles with "(primary)" label', () => {
    const text = buildEmbeddingText(makeExercise());
    expect(text).toContain('chest (primary)');
  });

  it('includes secondary muscles joined together with "(secondary)" label', () => {
    const text = buildEmbeddingText(makeExercise());
    // Secondary muscles are joined: "shoulders_front, triceps (secondary)"
    expect(text).toContain('shoulders_front');
    expect(text).toContain('triceps (secondary)');
    expect(text).toContain('secondary');
  });

  it('includes complexity', () => {
    const text = buildEmbeddingText(makeExercise());
    expect(text).toContain('Complexity: intermediate');
  });

  it('includes description when present', () => {
    const text = buildEmbeddingText(makeExercise());
    expect(text).toContain('Classic chest compound movement with barbell');
  });

  it('omits description when null', () => {
    const text = buildEmbeddingText(makeExercise({ description: null }));
    expect(text).not.toContain('null');
    expect(text).toContain('Barbell Bench Press');
  });

  it('handles exercise with no muscle groups', () => {
    const text = buildEmbeddingText(makeExercise({ muscleGroups: [] }));
    expect(text).toContain('Barbell Bench Press');
    expect(text).not.toContain('primary');
    expect(text).not.toContain('secondary');
  });

  it('handles exercise with only primary muscles (no secondary)', () => {
    const text = buildEmbeddingText(
      makeExercise({
        muscleGroups: [{ muscleGroup: 'chest' as const, involvement: 'primary' as const }],
      }),
    );
    expect(text).toContain('chest (primary)');
    expect(text).not.toContain('secondary');
  });

  it('produces deterministic output for same input', () => {
    const ex = makeExercise();
    expect(buildEmbeddingText(ex)).toBe(buildEmbeddingText(ex));
  });
});
