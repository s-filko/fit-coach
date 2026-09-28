import { SUMMARIZER_V3 } from '../v3';

const TRANSCRIPT = 'User: Плечо болит после жима\nAssistant: Понял, снизим нагрузку.';

describe('SUMMARIZER_V3 (P6 Task 2, owner decision 2026-09-17)', () => {
  it('renders two sections like v2 (system, user)', () => {
    const sections = SUMMARIZER_V3.render({ phase: 'training', transcript: TRANSCRIPT });
    expect(sections).toHaveLength(2);
    expect(sections.map(s => s.id)).toEqual(['system', 'user']);
  });

  it('the system section instructs a facts field and permits an empty array', () => {
    const [system] = SUMMARIZER_V3.render({ phase: 'training', transcript: TRANSCRIPT });
    expect(system!.text).toContain('facts');
    expect(system!.text).toMatch(/empty array/i);
  });

  it('the system section distinguishes durable facts from episode chatter (weights, reps, momentary state)', () => {
    const [system] = SUMMARIZER_V3.render({ phase: 'training', transcript: TRANSCRIPT });
    expect(system!.text).toMatch(/durable/i);
    expect(system!.text).toMatch(/weights, reps/i);
  });

  it('the system section names all eight categories and the muscleGroup tag for physical_constraint', () => {
    const [system] = SUMMARIZER_V3.render({ phase: 'training', transcript: TRANSCRIPT });
    const categories = [
      'physical_constraint',
      'exercise_preference',
      'exercise_dislike',
      'physiological_pattern',
      'coaching_preference',
      'schedule_constraint',
      'equipment',
      'nutrition_preference',
    ];
    for (const category of categories) {
      expect(system!.text).toContain(category);
    }
    expect(system!.text).toContain('muscleGroup');
  });

  it('the user section embeds the transcript and phase, same shape as v2', () => {
    const [, user] = SUMMARIZER_V3.render({ phase: 'training', transcript: TRANSCRIPT });
    expect(user!.text).toContain(TRANSCRIPT);
    expect(user!.text).toContain('training');
  });
});
