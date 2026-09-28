/**
 * set-kind plan, Task 1 (D5, AC-SK-4): `StrengthSetDataSchema` gains an optional `perHand`
 * boolean — the dumbbell/kettlebell load-basis flag. RED today: the schema does not declare the
 * field, so zod's default "strip unknown keys" parsing drops it silently.
 */
import { SetDataSchema } from '../set-data.types';

describe('SetDataSchema — strength perHand (set-kind plan D5, AC-SK-4)', () => {
  it('accepts and keeps perHand: true on a strength set', () => {
    const parsed = SetDataSchema.parse({ type: 'strength', reps: 10, weight: 12, weightUnit: 'kg', perHand: true });

    expect((parsed as { perHand?: boolean }).perHand).toBe(true);
  });

  it('accepts and keeps perHand: false on a strength set', () => {
    const parsed = SetDataSchema.parse({ type: 'strength', reps: 10, weight: 24, weightUnit: 'kg', perHand: false });

    expect((parsed as { perHand?: boolean }).perHand).toBe(false);
  });

  it('a strength set without perHand keeps the key absent (not just falsy)', () => {
    const parsed = SetDataSchema.parse({ type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' });

    expect('perHand' in parsed).toBe(false);
  });
});
