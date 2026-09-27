/**
 * Fact provenance (BUG-040, fact-provenance plan Task 2 — D4/D5/D6): the pure
 * guard's own unit tests. The compaction wiring is compact.node's; here every
 * rule is pinned directly: the D5 normalisation, the ≥3-char verbatim-quote
 * requirement, and D4's number provenance including the update's old-fact
 * allowance and the comma/dot equivalence.
 */
import { checkFactProvenance, normaliseForProvenance, type ProvenanceRejection } from '../fact-provenance';

function check(overrides: Partial<Parameters<typeof checkFactProvenance>[0]> = {}) {
  return checkFactProvenance({
    op: 'add',
    evidence: 'жму лёжа 100 кг',
    factText: 'Bench press working weight is 100 kg for 5 reps',
    userTexts: ['Я жму лёжа 100 кг на 5 повторов'],
    ...overrides,
  });
}

function reject(reason: ProvenanceRejection): { ok: false; reason: ProvenanceRejection } {
  return { ok: false, reason };
}

describe('normaliseForProvenance (D5)', () => {
  it('folds case, ё→е, quote characters, whitespace and edge punctuation', () => {
    expect(normaliseForProvenance('  «Ёлки-Палки»,  — зелёные…  ')).toBe('елки-палки, — зеленые');
  });

  it('is deterministic: the same input normalises identically', () => {
    const text = 'Почему ты его называешь «рычажным»?';
    expect(normaliseForProvenance(text)).toBe(normaliseForProvenance(text));
  });
});

describe('checkFactProvenance — evidence (D2/D5)', () => {
  it('a verbatim quote from a user line passes', () => {
    expect(check()).toEqual({ ok: true });
  });

  it('no evidence at all is missing_evidence (D2: skip, never fail)', () => {
    expect(check({ evidence: undefined })).toEqual(reject('missing_evidence'));
  });

  it('blank evidence is missing_evidence', () => {
    expect(check({ evidence: '   ' })).toEqual(reject('missing_evidence'));
  });

  it('a quote found in no user message is evidence_not_from_user (the Assistant line case)', () => {
    // BUG-040's shape: the figure exists in the episode — but only in the coach's reply.
    expect(
      check({
        evidence: '~70% веса платформы',
        factText: 'On the 45° leg press the platform weight adds to the plates',
        userTexts: ['Почему ты его называешь рычажным?'],
      }),
    ).toEqual(reject('evidence_not_from_user'));
  });

  it('a paraphrase or translation is not a quote', () => {
    expect(check({ evidence: 'I bench press 100 kg' })).toEqual(reject('evidence_not_from_user'));
  });

  it('a normalised quote shorter than 3 characters is evidence_not_from_user', () => {
    expect(check({ evidence: 'ок' })).toEqual(reject('evidence_not_from_user'));
  });

  it('normalisation bridges the model’s quoting: case, ё, paired quotes, terminal punctuation', () => {
    expect(check({ evidence: '«ЖМУ ЛЁЖА 100 КГ»,' })).toEqual({ ok: true });
  });
});

describe('checkFactProvenance — number provenance (D4)', () => {
  it('a number the user stated passes; one the user did not is number_not_user_stated', () => {
    expect(check({ factText: 'Working weight 100 kg' })).toEqual({ ok: true });
    // The BUG-040 number: the coach’s "~70%", the user never wrote it.
    expect(check({ factText: 'Platform weight is ~70% of its mass' })).toEqual(reject('number_not_user_stated'));
  });

  it('a too-greedy substring is not a match: 170 is not 70', () => {
    expect(check({ factText: 'Squat working weight 170 kg' })).toEqual(reject('number_not_user_stated'));
  });

  it('comma and dot decimals are the same number', () => {
    const userWroteComma = ['Пауза 1,5 секунды, жму лёжа 100 кг'];
    expect(check({ factText: 'Bench 100 kg, pause 1,5 s', userTexts: userWroteComma })).toEqual({ ok: true });
    expect(check({ factText: 'Bench 100 kg at RPE 1.5', userTexts: userWroteComma })).toEqual({ ok: true });
  });

  it('update: a number already in the OLD fact text also counts — the corrected value may keep it', () => {
    const input = {
      op: 'update' as const,
      evidence: 'Плановая нагрузка выросла',
      factText: 'Squat working weight 140 kg',
      userTexts: ['Плановая нагрузка выросла'],
      oldFactText: 'Squat working weight 120 kg',
    };
    expect(checkFactProvenance(input)).toEqual(reject('number_not_user_stated')); // 140 is new…
    expect(checkFactProvenance({ ...input, factText: 'Squat working weight 120 kg, beltless' })).toEqual({
      ok: true,
    }); // …but the old 120 may stay
  });

  it('a fact text with no numbers passes on the evidence alone', () => {
    expect(check({ factText: 'Trains at home with dumbbells' })).toEqual({ ok: true });
  });

  it('D12: a number the user did not state is refused even when only the phaseNote carries it', () => {
    // The fact text is clean; the coach's "~70%" hides in the phase note —
    // which is rendered into ## User Facts for long_term facts.
    expect(
      check({
        factText: 'Shoulder is recovering',
        phaseNote: 'the coach estimates ~70% recovered',
      }),
    ).toEqual(reject('number_not_user_stated'));
  });

  it('D12: a user-stated number in the phaseNote passes', () => {
    expect(
      check({
        evidence: 'болело 3 недели',
        factText: 'Shoulder is recovering',
        phaseNote: 'ached for 3 weeks',
        userTexts: ['болело 3 недели'],
      }),
    ).toEqual({ ok: true });
  });
});

describe('checkFactProvenance — per-op shape (D3/D6)', () => {
  it('retract checks the quote only — no fact text to number-check', () => {
    expect(
      check({
        op: 'retract',
        factText: undefined,
        evidence: 'плечо полностью здорово',
        userTexts: ['Плечо полностью здорово, можно жать'],
      }),
    ).toEqual({ ok: true });
  });

  it('a malformed op (no fact text) still needs its evidence quote', () => {
    expect(check({ factText: undefined, evidence: undefined })).toEqual(reject('missing_evidence'));
  });
});
