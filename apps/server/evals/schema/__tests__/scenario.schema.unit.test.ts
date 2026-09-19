import {
  assertionKnownBug,
  assertionLiveOnly,
  assertionText,
  RelativeTimeSchema,
  resolveRelativeTime,
  ScenarioSchema,
} from '../scenario.schema';

const T0 = new Date('2026-09-20T12:00:00.000Z');

const validScenario = {
  id: 'a-greeting-after-pause',
  description: 'greeting after a 14h pause with two past workouts',
  past: {
    user: { languageCode: 'ru', timezone: 'Europe/Berlin' },
    plan: {
      name: 'Full body 3x/week',
      sessions: [
        {
          key: 'upper_a',
          exercises: [
            { exercise: 'Bench Press', sets: 4, reps: '8-10', weight: 80 },
            { exercise: 'Pull-up', sets: 4, reps: '6-8' },
          ],
        },
      ],
    },
    workouts: [
      {
        at: '-4d',
        key: 'upper_a',
        exercises: [
          {
            exercise: 'Bench Press',
            sets: [
              { reps: 8, weight: 80, rpe: 8 },
              { reps: 7, weight: 80 },
            ],
          },
        ],
      },
      { at: '-2d', key: 'lower_a', exercises: [{ exercise: 'Squat', sets: [{ reps: 10, weight: 100 }] }] },
    ],
    facts: [{ category: 'exercise_preference', fact: 'prefers bench press over dumbbell press' }],
    conversation: {
      messages: [
        { role: 'human', text: 'сделай план' },
        { role: 'ai', text: 'готово, вот план' },
      ],
      summaries: [{ at: '-14h', phaseAtEnd: 'chat', openItems: ['plan ready, pending save'] }],
      lastUserMessageAt: '-14h',
    },
  },
  steps: [
    { action: 'advance', at: '+1h' },
    {
      action: 'user',
      text: 'привет',
      script: [
        {
          text: 'Привет! Готов тренироваться?',
          toolCall: { name: 'request_transition', args: { toPhase: 'session_planning' } },
        },
        { text: 'Переходим к планированию.' },
      ],
      expect: {
        seen: { mustMatch: ['RECENT TRAINING HISTORY'] },
        tools: { must: ['request_transition'] },
        phaseAfter: { phase: 'session_planning' },
        delivered: { mustMatch: ['Привет'] },
        persisted: { session: { status: 'planning' }, turnRecorded: true },
      },
    },
    {
      action: 'user',
      text: 'что я делал в прошлый раз?',
      expect: { seen: { mustMatch: ['Bench Press'], knownBug: 'BUG-018/AC-CC-1' } },
    },
  ],
};

/** `ScenarioSchema.parse` takes unknown, so broken literals type-check by construction. */
const withSteps = (steps: object[]): unknown => ({ ...validScenario, steps });

describe('RelativeTimeSchema (AC-TJ-1 — offsets from T0)', () => {
  it.each(['-3d', '+6h', '-14h', '+3.5h', '-30m', '+0h'])('accepts %s', spec => {
    expect(() => RelativeTimeSchema.parse(spec)).not.toThrow();
  });

  it.each([
    ['3d', 'no sign'],
    ['-3w', 'unknown unit'],
    ['-3', 'no unit'],
    ['now', 'not an offset'],
    ['+3,5h', 'comma fraction'],
    ['-3D', 'uppercase unit'],
    ['', 'empty'],
  ])('rejects %s (%s)', spec => {
    expect(() => RelativeTimeSchema.parse(spec)).toThrow();
  });

  it('resolves past and future offsets to exact millisecond dates', () => {
    expect(resolveRelativeTime('-3d', T0).getTime()).toBe(T0.getTime() - 3 * 86_400_000);
    expect(resolveRelativeTime('+6h', T0).getTime()).toBe(T0.getTime() + 6 * 3_600_000);
    expect(resolveRelativeTime('-14h', T0).getTime()).toBe(T0.getTime() - 14 * 3_600_000);
    expect(resolveRelativeTime('+3.5h', T0).getTime()).toBe(T0.getTime() + 3.5 * 3_600_000);
    expect(resolveRelativeTime('+1.5d', T0).getTime()).toBe(T0.getTime() + 1.5 * 86_400_000);
    expect(resolveRelativeTime('-30m', T0).getTime()).toBe(T0.getTime() - 30 * 60_000);
  });

  it('throws a named error on a spec the schema would have rejected', () => {
    expect(() => resolveRelativeTime('3d', T0)).toThrow(/Invalid relative time/);
  });
});

describe('ScenarioSchema (AC-TJ-1 — one scenario format for both layers)', () => {
  it('accepts a valid multi-step scenario', () => {
    expect(() => ScenarioSchema.parse(validScenario)).not.toThrow();
  });

  it('defaults the optional past collections and step expectations to empty', () => {
    const parsed = ScenarioSchema.parse({
      id: 'minimal',
      past: { user: { languageCode: 'ru', timezone: 'UTC' }, conversation: {} },
      steps: [{ action: 'user', text: 'привет' }],
    });
    expect(parsed.past.workouts).toEqual([]);
    expect(parsed.past.facts).toEqual([]);
    expect(parsed.past.conversation?.messages).toEqual([]);
    expect(parsed.past.conversation?.summaries).toEqual([]);
    expect(parsed.steps[0]?.expect).toBeUndefined();
  });

  it('rejects a scenario with no steps', () => {
    expect(() => ScenarioSchema.parse({ ...validScenario, steps: [] })).toThrow();
  });

  it('rejects a workout without a parsable timestamp (repo orders by createdAt — seeds need one)', () => {
    expect(() =>
      ScenarioSchema.parse({
        ...validScenario,
        past: { ...validScenario.past, workouts: [{ at: 'yesterday', key: 'upper_a', exercises: [] }] },
      }),
    ).toThrow();
  });

  it('rejects an unknown step action', () => {
    expect(() => ScenarioSchema.parse(withSteps([{ action: 'wait' }]))).toThrow();
  });

  it('rejects a user step without text', () => {
    expect(() => ScenarioSchema.parse(withSteps([{ action: 'user' }]))).toThrow();
  });

  it('rejects an advance step without a relative time', () => {
    expect(() => ScenarioSchema.parse(withSteps([{ action: 'advance' }]))).toThrow();
  });

  it('rejects a scripted message carrying neither text nor a tool call', () => {
    expect(() => ScenarioSchema.parse(withSteps([{ action: 'user', text: 'привет', script: [{}] }]))).toThrow();
  });

  it('rejects an unknown persisted session status', () => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([{ action: 'user', text: 'привет', expect: { persisted: { session: { status: 'finished' } } } }]),
      ),
    ).toThrow();
  });
});

describe('knownBug tag (AC-TJ-1 — optional per assertion)', () => {
  it.each(['BUG-018', 'BUG-018/AC-CC-1', 'BUG-007/AC-1361'] as const)('accepts %s', tag => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([
          { action: 'user', text: 'привет', expect: { delivered: { mustMatch: ['Привет'], knownBug: tag } } },
        ]),
      ),
    ).not.toThrow();
  });

  it.each(['bug-018', 'BUG-018/CC-1', 'BUG-018/AC-CC-x', 'AC-CC-1'] as const)('rejects %s', tag => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([
          { action: 'user', text: 'привет', expect: { delivered: { mustMatch: ['Привет'], knownBug: tag } } },
        ]),
      ),
    ).toThrow();
  });
});

describe('per-assertion knownBug (Task 4 Step 0 — one tag per single assertion)', () => {
  it('accepts tagged entries inside seen.mustMatch alongside bare strings', () => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([
          {
            action: 'user',
            text: 'давай верх',
            expect: {
              seen: {
                mustMatch: [
                  '=== RECENT TRAINING HISTORY',
                  { text: 'привет, хочу потренироваться', knownBug: 'BUG-018/AC-CC-1' },
                  { text: 'Привет, Алекс!', knownBug: 'BUG-018/AC-CC-1' },
                ],
              },
            },
          },
        ]),
      ),
    ).not.toThrow();
  });

  it.each(['seen', 'delivered'] as const)('accepts tagged entries in %s.mustNotMatch', plane => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([
          {
            action: 'user',
            text: 'привет',
            expect: { [plane]: { mustNotMatch: [{ text: 'Ничего не записал', knownBug: 'BUG-018/AC-CC-3' }] } },
          },
        ]),
      ),
    ).not.toThrow();
  });

  it('accepts tagged entries in tools.must and tools.mustNot', () => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([
          {
            action: 'user',
            text: 'да, поехали',
            expect: {
              tools: {
                must: [{ text: 'start_training_session', knownBug: 'BUG-015' }],
                mustNot: [{ text: 'finish_training', knownBug: 'BUG-006' }],
              },
            },
          },
        ]),
      ),
    ).not.toThrow();
  });

  it('rejects a bad tag on a tagged entry', () => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([
          {
            action: 'user',
            text: 'привет',
            expect: { seen: { mustMatch: [{ text: 'Привет', knownBug: 'CC-1' }] } },
          },
        ]),
      ),
    ).toThrow();
  });

  it('rejects a tagged entry without text', () => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([{ action: 'user', text: 'привет', expect: { seen: { mustMatch: [{ knownBug: 'BUG-018' }] } } }]),
      ),
    ).toThrow();
  });

  it('keeps the plane-level knownBug valid (backward compatibility, journey A)', () => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([
          { action: 'user', text: 'привет', expect: { delivered: { mustMatch: ['Привет'], knownBug: 'BUG-018/AC-CC-3' } } },
        ]),
      ),
    ).not.toThrow();
  });
});

describe('liveOnly tag (Task 5b — the L3 layer checks it, the deterministic layer skips it)', () => {
  it('accepts a liveOnly entry alongside bare strings and knownBug entries', () => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([
          {
            action: 'user',
            text: 'забыл дописать: подтягивания 3×8',
            expect: {
              delivered: {
                mustMatch: [
                  'Записал подтягивания 3×8 к предыдущей тренировке.',
                  { text: 'к предыдущей тренировке', liveOnly: true },
                  { text: 'закрыть её или добавить', liveOnly: true },
                ],
              },
            },
          },
        ]),
      ),
    ).not.toThrow();
  });

  it('accepts liveOnly combined with a knownBug tag', () => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([
          {
            action: 'user',
            text: 'привет',
            expect: { delivered: { mustMatch: [{ text: 'Привет', knownBug: 'BUG-018/AC-CC-3', liveOnly: true }] } },
          },
        ]),
      ),
    ).not.toThrow();
  });

  it('rejects a tagged entry with neither knownBug nor liveOnly (use a bare string)', () => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([{ action: 'user', text: 'привет', expect: { delivered: { mustMatch: [{ text: 'Привет' }] } } }]),
      ),
    ).toThrow();
  });

  it('rejects liveOnly: false (only the literal true marks the entry)', () => {
    expect(() =>
      ScenarioSchema.parse(
        withSteps([
          { action: 'user', text: 'привет', expect: { delivered: { mustMatch: [{ text: 'Привет', liveOnly: false }] } } },
        ]),
      ),
    ).toThrow();
  });

  it('assertionLiveOnly flags exactly the liveOnly entries and never a bare string', () => {
    const entries = [
      'always checked',
      { text: 'known bug', knownBug: 'BUG-018/AC-CC-1' },
      { text: 'live only', liveOnly: true },
      { text: 'both', knownBug: 'BUG-018/AC-CC-2', liveOnly: true },
    ] as const;
    expect(entries.map(assertionLiveOnly)).toEqual([false, false, true, true]);
    // The other accessors still see every entry.
    expect(entries.map(assertionText)).toEqual(['always checked', 'known bug', 'live only', 'both']);
    expect(entries.map(assertionKnownBug)).toEqual([null, 'BUG-018/AC-CC-1', null, 'BUG-018/AC-CC-2']);
  });
});
