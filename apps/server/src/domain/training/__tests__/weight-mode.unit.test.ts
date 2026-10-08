import { deriveWeightMode } from '../weight-mode';

// T7 (AC-PTF-7): the catalog weight contract follows category/equipment — the same rule the
// T7 migration backfills into existing rows and exercises.seed applies to fresh databases.
// No counterweight value: the Gravitron is `required`; its meaning comes from its name
// ("Assisted …"), checked live in plan coach-quality-proof.
describe('deriveWeightMode (AC-PTF-7)', () => {
  it('equipment bodyweight → optional (Pull-ups, Dips, Burpees)', () => {
    expect(deriveWeightMode('compound', 'bodyweight')).toBe('optional');
    expect(deriveWeightMode('functional', 'bodyweight')).toBe('optional');
  });

  it('category cardio → none, whatever the equipment (Running on none, Treadmill and Rowing on machine)', () => {
    expect(deriveWeightMode('cardio', 'none')).toBe('none');
    expect(deriveWeightMode('cardio', 'machine')).toBe('none');
  });

  it('equipment none (non-cardio) → none (Jump Rope)', () => {
    expect(deriveWeightMode('functional', 'none')).toBe('none');
  });

  it('barbell, dumbbell, cable and machine — the Gravitron included → required', () => {
    expect(deriveWeightMode('compound', 'barbell')).toBe('required');
    expect(deriveWeightMode('isolation', 'dumbbell')).toBe('required');
    expect(deriveWeightMode('isolation', 'cable')).toBe('required');
    expect(deriveWeightMode('compound', 'machine')).toBe('required');
  });
});
