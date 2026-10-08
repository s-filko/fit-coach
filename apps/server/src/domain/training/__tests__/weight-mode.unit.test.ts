import { deriveWeightMode } from '../weight-mode';

// T7 (AC-PTF-7): the catalog weight contract follows category/equipment — the same rule the
// T7 migration backfills into existing rows and exercises.seed applies to fresh databases.
// No counterweight value: the Gravitron is `required`; its meaning comes from its name
// ("Assisted …"), checked live in plan coach-quality-proof.
describe('deriveWeightMode (AC-PTF-7)', () => {
  it('equipment bodyweight → optional (Pull-ups, Dips, Burpees)', () => {
    expect(deriveWeightMode('compound', 'bodyweight', 'strength')).toBe('optional');
    expect(deriveWeightMode('functional', 'bodyweight', 'strength')).toBe('optional');
  });

  it('category cardio → none, whatever the equipment (Running on none, Treadmill and Rowing on machine)', () => {
    expect(deriveWeightMode('cardio', 'none', 'strength')).toBe('none');
    expect(deriveWeightMode('cardio', 'machine', 'strength')).toBe('none');
  });

  it('equipment none (non-cardio) → none (Jump Rope)', () => {
    expect(deriveWeightMode('functional', 'none', 'strength')).toBe('none');
  });

  // An ab machine is used without added load: a reps-only movement on a machine is optional.
  it('a reps-only machine movement (Ab Coaster) → optional; a strength machine stays required', () => {
    expect(deriveWeightMode('functional', 'machine', 'functional_reps')).toBe('optional');
    expect(deriveWeightMode('compound', 'machine', 'strength')).toBe('required');
  });

  it('barbell, dumbbell, cable and machine — the Gravitron included → required', () => {
    expect(deriveWeightMode('compound', 'barbell', 'strength')).toBe('required');
    expect(deriveWeightMode('isolation', 'dumbbell', 'strength')).toBe('required');
    expect(deriveWeightMode('isolation', 'cable', 'strength')).toBe('required');
    expect(deriveWeightMode('compound', 'machine', 'strength')).toBe('required');
  });
});
