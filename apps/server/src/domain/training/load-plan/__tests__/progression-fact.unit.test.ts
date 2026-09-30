import {
  chosenSchemeOf,
  formatProgressionFact,
  parseProgressionFact,
  progressionFromChoice,
  progressionLine,
} from '../progression-fact';
import { defaultProgression } from '../scheme-default';

/** D8: the `progression_scheme` fact — a registry id validated in code, the user's words, newest active wins. */
describe('progression_scheme fact text', () => {
  it('round-trips the registry id and the user words', () => {
    const text = formatProgressionFact({ schemeId: 'double_progression', words: 'I want rep progression' });
    expect(text).toBe('progression_scheme id=double_progression — I want rep progression');
    expect(parseProgressionFact(text)).toEqual({ schemeId: 'double_progression', words: 'I want rep progression' });
  });

  it('words are optional', () => {
    expect(parseProgressionFact('progression_scheme id=linear_progression')).toEqual({
      schemeId: 'linear_progression',
      words: '',
    });
  });

  it.each([
    ['progression_scheme id=rpe_autoregulation — x'],
    ['progression_scheme id=constructor'],
    ['progression_scheme id='],
    ['I like double progression'],
    [''],
  ])('rejects %j (unknown id or another shape)', text => {
    expect(parseProgressionFact(text)).toBeNull();
  });
});

describe('chosenSchemeOf (newest active fact wins)', () => {
  const f = (text: string, iso: string) => ({ fact: text, createdAt: new Date(iso) });
  it('picks the newest valid fact and ignores malformed ones', () => {
    const chosen = chosenSchemeOf([
      f('progression_scheme id=double_progression — a', '2026-09-01T00:00:00Z'),
      f('progression_scheme id=linear_progression — b', '2026-09-20T00:00:00Z'),
      f('progression_scheme id=nonsense', '2026-09-25T00:00:00Z'),
      f('unrelated', '2026-09-26T00:00:00Z'),
    ]);
    expect(chosen).toEqual({ schemeId: 'linear_progression', chosenAt: new Date('2026-09-20T00:00:00Z') });
  });
  it('null when there is none', () => {
    expect(chosenSchemeOf([])).toBeNull();
  });
});

describe('progressionFromChoice / progressionLine', () => {
  const profile = defaultProgression({ fitnessLevel: 'intermediate', fitnessGoal: 'build muscle' });

  it('the choice overrides the default scheme and keeps the profile goal', () => {
    const p = progressionFromChoice(profile, {
      schemeId: 'linear_progression',
      chosenAt: new Date('2026-09-20T00:00:00Z'),
    });
    expect(p.scheme.id).toBe('linear_progression');
    expect(p.goal).toBe('hypertrophy');
    expect(p.source).toBe('user');
    expect(p.chosenAt).toEqual(new Date('2026-09-20T00:00:00Z'));
  });

  it('no choice → the default, unchanged', () => {
    expect(progressionFromChoice(profile, null)).toBe(profile);
  });

  it('prints the one line with provenance', () => {
    const chosen = progressionFromChoice(profile, {
      schemeId: 'double_progression',
      chosenAt: new Date('2026-09-20T03:00:00Z'),
    });
    expect(progressionLine(chosen, 'Asia/Manila')).toBe(
      'Progression: double, 8–12, confirm ×2 — chosen by user 2026-09-20',
    );
    expect(progressionLine(profile, 'Asia/Manila')).toBe(
      'Progression: double, 8–12, confirm ×2 — default, unconfirmed',
    );
    const linear = progressionFromChoice(profile, {
      schemeId: 'linear_progression',
      chosenAt: new Date('2026-09-20T03:00:00Z'),
    });
    expect(progressionLine(linear, 'Asia/Manila')).toBe(
      'Progression: linear, 8 reps, confirm ×2 — chosen by user 2026-09-20',
    );
  });
});
