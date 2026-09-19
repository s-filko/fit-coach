import { RelativeTimeSchema, resolveRelativeTime, ScenarioSchema } from '../scenario.schema';

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
