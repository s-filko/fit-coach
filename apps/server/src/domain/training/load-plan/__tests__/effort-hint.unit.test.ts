import { effortHint, type EffortHintInput } from '../effort-hint';

/**
 * AC-LPF-11 (item 10): `log_set` hints the coach to ask the effort when a decision-critical set is stored without RPE —
 * the last planned set, a set below the floor, a set ≥ 3 reps above the top (the opener included). Once per exercise
 * per session, never when RPE or a phrase (feedback) was given. The code decides; the model only asks.
 */
const strength = (reps: number, over: Partial<EffortHintInput['set']> = {}): EffortHintInput['set'] => ({
  reps,
  weight: 60,
  rpe: null,
  feedback: null,
  isWarmup: false,
  ...over,
});

const input = (over: Partial<EffortHintInput> = {}): EffortHintInput => ({
  set: strength(9),
  earlier: [],
  targetReps: '8-10',
  targetSets: 3,
  ...over,
});

describe('AC-LPF-11 · effortHint', () => {
  it('a set below the floor without RPE → hint with the plain-language question and the RPE mapping', () => {
    const h = effortHint(input({ set: strength(6) }));
    expect(h).toContain('below the rep floor');
    expect(h).toContain('Сколько ещё раз смог бы сделать на этом весе? 0, 1–2 или 3 и больше?');
    expect(h).toContain('update_last_set');
    expect(h).toMatch(/0 → 10.*1–2 → 8.*3\+ → 7/);
  });

  it('a set ≥ 3 reps above the top (the opener too) → hint; 2 above is not critical', () => {
    expect(effortHint(input({ set: strength(13) }))).toContain('above the rep range');
    expect(effortHint(input({ set: strength(12) }))).toBeNull();
  });

  it('the last planned set → hint; an earlier in-range set → none', () => {
    const earlier = [strength(9), strength(9)];
    expect(effortHint(input({ set: strength(9), earlier }))).toContain('last planned set');
    expect(effortHint(input({ set: strength(9), earlier: [strength(9)] }))).toBeNull();
  });

  it('an unknown number of planned sets and no range → never a hint', () => {
    expect(effortHint(input({ set: strength(3), targetReps: null, targetSets: null }))).toBeNull();
  });

  it('never when RPE or a phrase is given on this set', () => {
    expect(effortHint(input({ set: strength(6, { rpe: 8 }) }))).toBeNull();
    expect(effortHint(input({ set: strength(6, { feedback: 'еле дожал' }) }))).toBeNull();
  });

  it('never when the user already gave an RPE earlier on this exercise', () => {
    expect(effortHint(input({ set: strength(6), earlier: [strength(9, { rpe: 9 })] }))).toBeNull();
  });

  it('once per exercise per session: an earlier critical set without RPE already triggered the hint', () => {
    expect(effortHint(input({ set: strength(6), earlier: [strength(13)] }))).toBeNull();
    expect(effortHint(input({ set: strength(6), earlier: [strength(9)] }))).not.toBeNull();
  });

  it('warm-ups and sets without a load are not decision-critical', () => {
    expect(effortHint(input({ set: strength(6, { isWarmup: true }) }))).toBeNull();
    expect(effortHint(input({ set: strength(6, { weight: null }) }))).toBeNull();
  });

  it('earlier warm-ups do not count as working sets for "last planned set"', () => {
    const earlier = [strength(15, { isWarmup: true }), strength(9)];
    expect(effortHint(input({ set: strength(9), earlier }))).toBeNull();
  });
});
