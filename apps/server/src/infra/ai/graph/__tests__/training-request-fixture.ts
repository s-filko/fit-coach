/**
 * Offline training request (coach-simplification I1, AC-CS1-5): fixtures and the assembly of the exact request the
 * training phase sends — the real `TRAINING_COACH`, `# Today` / `# History` blocks, `workoutHistory` and
 * `assembleContext`, over in-memory data. No DB, no model. Used by `scripts/print-training-request.ts` and by
 * `training-request.size.unit.test.ts`. All data is invented; `CASE07_FIXTURE` reproduces the SHAPE of the i0
 * case-07 moment (same exercises, loads and message count) for the size measurement.
 */
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';

import type { ExerciseLastPerformance } from '@domain/training/ports/workout-session.ports';
import type {
  ExerciseWithMuscles,
  SessionExerciseStatus,
  SessionExerciseWithDetails,
  SessionSet,
  SetData,
  SetKind,
  WorkoutSessionWithDetails,
} from '@domain/training/types';
import type { UserFact } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { assembleContext } from '@infra/ai/context/assemble-context';
import { estimateMessages, estimateTokens } from '@infra/ai/context/token-estimator';
import { workoutHistory } from '@infra/ai/graph/episode';
import type { ConversationGraphDeps } from '@infra/ai/graph/phase-spec';
import { buildTrainingSpec, type TrainingData } from '@infra/ai/graph/phases/training.spec';
import { collectLoadsUsed, CURRENT_TIME_V1, type ExerciseHistory, renderBlock } from '@infra/ai/prompts/blocks';
import { compose } from '@infra/ai/prompts/compose';

export interface RequestFixture {
  name: string;
  now: Date;
  timezone: string;
  user: User;
  data: TrainingData;
  /** The checkpointed history: earlier chat, the `start_training_session` call and this workout's messages. */
  history: BaseMessage[];
  /** The client's message that triggers this run. */
  current: HumanMessage;
}

// ---------------------------------------------------------------- builders

const long = (iso: string, time = '11:00:00.000Z'): Date => new Date(`${iso}T${time}`);

export function exerciseOf(id: string, name: string): ExerciseWithMuscles {
  return {
    id,
    name,
    category: 'compound',
    equipment: 'machine',
    exerciseType: 'strength',
    weightMode: 'required',
    description: null,
    energyCost: 'medium',
    complexity: 'intermediate',
    typicalDurationMinutes: 10,
    requiresSpotter: false,
    imageUrl: null,
    videoUrl: null,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    muscleGroups: [],
  };
}

export class SetFactory {
  private seq = 0;
  constructor(private readonly at: Date) {}

  one(setData: SetData, extra: { rpe?: number | null; kind?: SetKind; note?: string } = {}): SessionSet {
    this.seq += 1;
    return {
      id: `set-${this.seq}`,
      sessionExerciseId: 'se',
      setNumber: this.seq,
      rpe: extra.rpe ?? null,
      userFeedback: extra.note ?? null,
      createdAt: this.at,
      completedAt: this.at,
      setData,
      setKind: extra.kind ?? 'working',
    };
  }

  /** kg strength sets from `[reps, weight, rpe?]` rows. */
  strength(rows: Array<[number, number, number?]>): SessionSet[] {
    return rows.map(([reps, weight, rpe]) => this.one({ type: 'strength', reps, weight, weightUnit: 'kg' }, { rpe }));
  }

  holds(seconds: number[]): SessionSet[] {
    return seconds.map(s => this.one({ type: 'isometric', duration: s }));
  }

  warmup(reps: number, weight: number): SessionSet {
    return this.one({ type: 'strength', reps, weight, weightUnit: 'kg' }, { kind: 'warmup' });
  }

  cardio(seconds: number, kind: SetKind = 'working'): SessionSet {
    return this.one({ type: 'cardio_duration', duration: seconds }, { kind });
  }
}

export function sessionExercise(
  id: string,
  name: string,
  sets: SessionSet[],
  status: SessionExerciseStatus,
): SessionExerciseWithDetails {
  return {
    id: `se-${id}`,
    sessionId: 'sess',
    exerciseId: id,
    orderIndex: 0,
    status,
    targetSets: null,
    targetReps: null,
    targetWeight: null,
    actualRepsRange: null,
    userFeedback: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    exercise: exerciseOf(id, name),
    sets,
  };
}

export function performance(id: string, name: string, date: string, sets: SessionSet[]): ExerciseLastPerformance {
  return { exerciseId: id, completedAt: long(date), sessionExercise: sessionExercise(id, name, sets, 'completed') };
}

export interface Row {
  id: string;
  name: string;
  planned: string | null;
  /** Newest first. */
  past: Array<[string, SessionSet[]]>;
}

export const historyOf = (rows: Row[]): ExerciseHistory[] =>
  rows.map(r => ({
    exerciseId: r.id,
    exerciseName: r.name,
    plannedText: r.planned,
    weightMode: null,
    performances: r.past.map(([date, sets]) => performance(r.id, r.name, date, sets)),
    lastSkippedAt: null,
    loadsUsed: collectLoadsUsed(r.past.map(([date, sets]) => performance(r.id, r.name, date, sets))),
  }));

export function sessionOf(
  started: Date,
  last: Date,
  plan: Array<{ id: string; name: string; sets: number; reps: string }>,
  exercises: SessionExerciseWithDetails[],
): WorkoutSessionWithDetails {
  return {
    id: 'sess',
    userId: 'u1',
    planId: null,
    sessionKey: null,
    status: 'in_progress',
    place: null,
    startedAt: started,
    completedAt: null,
    durationMinutes: null,
    userContextJson: null,
    sessionPlanJson: {
      sessionKey: 'k',
      sessionName: 'Session',
      reasoning: '',
      exercises: plan.map(p => ({
        exerciseId: p.id,
        exerciseName: p.name,
        targetSets: p.sets,
        targetReps: p.reps,
        restSeconds: 60,
      })),
      estimatedDuration: 45,
    },
    lastActivityAt: last,
    autoCloseReason: null,
    createdAt: started,
    updatedAt: started,
    exercises,
  };
}

export function factOf(
  n: number,
  category: UserFact['category'],
  fact: string,
  muscleGroup: string | null = null,
): UserFact {
  const at = new Date('2026-09-01T00:00:00.000Z');
  return {
    id: `fact-${n}`,
    userId: 'u1',
    category,
    fact,
    factKey: `k${n}`,
    muscleGroup,
    confirmations: 1,
    sourceTurnId: null,
    createdAt: at,
    updatedAt: at,
    durability: 'permanent',
    expiresAt: null,
    reviewAfter: null,
    phaseNote: null,
    phaseAt: null,
    onExpiry: null,
    status: 'active',
    archivedAt: null,
    archivedReason: null,
    closedByUserAt: null,
    supersedesId: null,
    context: null,
    evidence: null,
  };
}

/** The workout's messages: the chat before, the start call and its result, then `turns` as human/AI pairs. */
function workoutMessages(turns: Array<[string, string]>, loggedAfter: number[] = []): BaseMessage[] {
  const out: BaseMessage[] = [
    new HumanMessage({ content: 'Привет, пора тренироваться', id: 'c0' }),
    new AIMessage({ content: 'Привет! Готов?', id: 'c1' }),
    new HumanMessage({ content: 'начал тренировку', id: 'w0' }),
    new AIMessage({
      content: '',
      id: 'w1',
      tool_calls: [{ id: 'call-start', name: 'start_training_session', args: {} }],
    }),
    new ToolMessage({ content: '{"ok":true}', tool_call_id: 'call-start', id: 'w2' }),
  ];
  turns.forEach(([client, coach], i) => {
    out.push(new HumanMessage({ content: client, id: `h${i}` }));
    if (loggedAfter.includes(i)) {
      out.push(
        new AIMessage({
          content: '',
          id: `t${i}`,
          tool_calls: [
            { id: `call-${i}`, name: 'log_set', args: { exerciseId: 'x', setData: { type: 'strength', reps: 10 } } },
          ],
        }),
        new ToolMessage({ content: '{"ok":true,"set":"logged"}', tool_call_id: `call-${i}`, id: `r${i}` }),
      );
    }
    out.push(new AIMessage({ content: coach, id: `a${i}` }));
  });
  return out;
}

// ----------------------------------------------------------- plain fixture

const PID = {
  row: 'a1111111-1111-4111-8111-111111111111',
  pull: 'a2222222-2222-4222-8222-222222222222',
  cable: 'a3333333-3333-4333-8333-333333333333',
  press: 'a4444444-4444-4444-8444-444444444444',
  raise: 'a5555555-5555-4555-8555-555555555555',
  plank: 'a6666666-6666-4666-8666-666666666666',
  face: 'a7777777-7777-4777-8777-777777777777',
};

function plainFixture(): RequestFixture {
  const now = new Date('2026-10-02T11:20:00.000Z'); // Friday Oct 2, 19:20 Asia/Manila
  const f = new SetFactory(now);
  const past = new SetFactory(long('2026-09-27'));
  const session = sessionOf(
    new Date('2026-10-02T10:35:00.000Z'),
    new Date('2026-10-02T11:18:00.000Z'),
    [
      { id: PID.row, name: 'Rowing Machine', sets: 1, reps: '5 min' },
      { id: PID.pull, name: 'Lat Pulldown', sets: 4, reps: '10' },
      { id: PID.cable, name: 'Seated Cable Row', sets: 3, reps: '12' },
      { id: PID.press, name: 'Chest Press Machine', sets: 3, reps: '10' },
      { id: PID.raise, name: 'Cable Lateral Raise', sets: 3, reps: '15' },
      { id: PID.plank, name: 'Plank', sets: 2, reps: '45 s' },
    ],
    [
      sessionExercise(PID.row, 'Rowing Machine', [f.cardio(300, 'warmup')], 'completed'),
      sessionExercise(
        PID.pull,
        'Lat Pulldown',
        [
          f.warmup(10, 30),
          ...f.strength([
            [10, 50, 7],
            [10, 55, 8],
            [10, 55, 8],
            [9, 55, 9.5],
          ]),
        ],
        'completed',
      ),
      sessionExercise(
        PID.cable,
        'Seated Cable Row',
        f.strength([
          [12, 45, 7],
          [12, 50, 8],
          [11, 50, 9],
        ]),
        'in_progress',
      ),
      sessionExercise(
        PID.face,
        'Face Pull',
        f.strength([
          [15, 20],
          [15, 20, 7],
        ]),
        'completed',
      ),
    ],
  );
  const history = historyOf([
    {
      id: PID.row,
      name: 'Rowing Machine',
      planned: '1×5 min',
      past: [
        ['2026-09-29', [past.cardio(300, 'warmup')]],
        ['2026-09-27', [past.cardio(360, 'warmup')]],
        ['2026-09-22', [past.cardio(300, 'warmup')]],
      ],
    },
    {
      id: PID.pull,
      name: 'Lat Pulldown',
      planned: '4×10',
      past: [
        [
          '2026-09-29',
          past.strength([
            [10, 45, 7],
            [10, 50, 8],
            [10, 50, 8],
            [10, 50, 9],
          ]),
        ],
        [
          '2026-09-24',
          past.strength([
            [10, 45],
            [10, 45],
            [10, 50, 9],
            [8, 50, 9],
          ]),
        ],
        [
          '2026-09-19',
          past.strength([
            [10, 40, 7],
            [10, 40, 7],
            [10, 45, 8],
            [10, 45, 8],
          ]),
        ],
      ],
    },
    {
      id: PID.cable,
      name: 'Seated Cable Row',
      planned: '3×12',
      past: [
        [
          '2026-09-29',
          past.strength([
            [12, 45, 7],
            [12, 45, 8],
            [12, 50, 9],
          ]),
        ],
        [
          '2026-09-24',
          past.strength([
            [12, 40],
            [12, 45],
            [12, 45],
          ]),
        ],
        [
          '2026-09-19',
          past.strength([
            [12, 40, 7],
            [12, 40, 7],
            [10, 45, 9],
          ]),
        ],
      ],
    },
    {
      id: PID.press,
      name: 'Chest Press Machine',
      planned: '3×10',
      past: [
        [
          '2026-09-27',
          past.strength([
            [10, 40, 7],
            [10, 45, 8],
            [10, 45, 9],
          ]),
        ],
        [
          '2026-09-22',
          past.strength([
            [10, 35, 7],
            [10, 40, 8],
            [10, 40, 8],
          ]),
        ],
        [
          '2026-09-17',
          past.strength([
            [10, 35],
            [10, 35],
            [10, 35],
          ]),
        ],
      ],
    },
    {
      id: PID.raise,
      name: 'Cable Lateral Raise',
      planned: '3×15',
      past: [
        [
          '2026-09-27',
          past.strength([
            [15, 7, 8],
            [15, 7, 9],
            [12, 7, 9],
          ]),
        ],
        [
          '2026-09-22',
          past.strength([
            [15, 5],
            [15, 5],
            [15, 7, 9],
          ]),
        ],
        [
          '2026-09-17',
          past.strength([
            [15, 5, 7],
            [15, 5, 7],
            [15, 5, 8],
          ]),
        ],
      ],
    },
    {
      id: PID.plank,
      name: 'Plank',
      planned: '2×45 s',
      past: [
        ['2026-09-29', past.holds([45, 45])],
        ['2026-09-24', past.holds([40, 40])],
        ['2026-09-19', past.holds([40, 35])],
      ],
    },
    {
      id: PID.face,
      name: 'Face Pull',
      planned: null,
      past: [
        [
          '2026-09-24',
          past.strength([
            [15, 20],
            [15, 20],
            [15, 25, 8],
          ]),
        ],
      ],
    },
  ]);
  const messages: Array<[string, string]> = [
    [
      'греб 5 минут для разминки',
      'Отлично, разминка есть. На тягу сверху: один лёгкий подход на 10 и дальше пробуй 55 кг на 10.',
    ],
    ['разминочный 10 на 30 сделал', 'Принято. Теперь рабочий: 50 на 10, как в прошлый раз, с запасом пары повторов.'],
    ['50 на 10 рпе 7', 'Записал: 10×50, RPE 7. Следующий пробуй 55 на 10, если запас останется.'],
    ['55 на 10 рпе 8', 'Записал: 10×55, RPE 8. Ещё один такой же.'],
    ['ещё 55 на 10 рпе 8', 'Записал: 10×55, RPE 8. Последний: 55, сколько сможешь до 10.'],
    [
      '9 повторов рпе 9.5',
      'Записал: 9×55, RPE 9.5. Это на повтор меньше плана, но вес выше прошлого раза. Дальше горизонтальная тяга.',
    ],
    ['тяга 45 на 12', 'Записал: 12×45. Следующий пробуй 50 на 12.'],
    ['50 на 12 рпе 8', 'Записал: 12×50, RPE 8. Ещё один на 50, до 12.'],
    ['11 повторов рпе 9', 'Записал: 11×50, RPE 9. Упражнение закончено?'],
    ['да, давай ещё face pull, это не по плану', 'Давай. 15 повторов на 20 кг, без отказа.'],
    ['15 на 20', 'Записал: 15×20. Ещё один, можно тяжелее, если легко.'],
    ['15 на 20 рпе 7', 'Записал: 15×20, RPE 7. Дальше жим в тренажёре, 45 на 10, как в прошлый раз.'],
    [
      'что у меня уже записано по тяге?',
      'Тяга сверху: 10×55 (RPE 8) два подхода, 9×55 (RPE 9.5), плюс разминочный. Горизонтальная тяга: 12×45, 12×50, 11×50.',
    ],
    ['а в прошлый раз сколько было на жиме?', 'Жим в тренажёре в прошлый раз: 10×40, 10×45, 10×45 (RPE 9).'],
  ];
  const current = new HumanMessage({ content: 'жим сделал 45 на 10 рпе 8', id: 'cur' });
  return {
    name: 'plain',
    now,
    timezone: 'Asia/Manila',
    user: {
      id: 'u1',
      firstName: 'Alex',
      fitnessLevel: 'intermediate',
      languageCode: 'ru',
      timezone: 'Asia/Manila',
    },
    data: {
      session,
      history,
      lastWorkout: { completedAt: long('2026-09-29'), exerciseNames: ['Rowing Machine', 'Lat Pulldown', 'Plank'] },
      warmupHabit: {
        workouts: 10,
        withCardio: 9,
        kinds: [
          { label: 'treadmill', minMinutes: 10, maxMinutes: 15 },
          { label: 'bike', minMinutes: 8, maxMinutes: 8 },
        ],
      },
      reportedToday: [],
      coachReplied: true,
      profileFacts: [
        factOf(1, 'physical_constraint', 'Shoulder: no overhead pressing, clicks at the top.', 'shoulder'),
        factOf(2, 'exercise_preference', 'Prefers machines and cables.'),
        factOf(3, 'schedule_constraint', 'Sessions last 45–50 minutes, about four a week.'),
        factOf(4, 'coaching_preference', 'Reports effort as RPE himself.'),
      ],
    },
    history: workoutMessages(messages, [2, 3, 4, 5]),
    current,
  };
}

// ------------------------------------------------------------ case 07 shape

const CID = {
  press: 'b1111111-1111-4111-8111-111111111111',
  ext: 'b2222222-2222-4222-8222-222222222222',
  curl: 'b3333333-3333-4333-8333-333333333333',
  calf: 'b4444444-4444-4444-8444-444444444444',
  plank: 'b5555555-5555-4555-8555-555555555555',
  side: 'b6666666-6666-4666-8666-666666666666',
  bike: 'b7777777-7777-4777-8777-777777777777',
};

function case07Fixture(): RequestFixture {
  const now = new Date('2026-10-01T10:59:00.000Z'); // Thursday Oct 1, 18:59 Asia/Manila
  const f = new SetFactory(now);
  const p = new SetFactory(long('2026-09-27'));
  const session = sessionOf(
    new Date('2026-10-01T10:38:00.000Z'),
    new Date('2026-10-01T10:58:00.000Z'),
    [
      { id: CID.press, name: '45° Leg Press', sets: 4, reps: '12' },
      { id: CID.ext, name: 'Leg Extension', sets: 3, reps: '15' },
      { id: CID.curl, name: 'Leg Curl', sets: 3, reps: '15' },
      { id: CID.calf, name: 'Standing Calf Raise Machine', sets: 3, reps: '25–30' },
      { id: CID.plank, name: 'Plank', sets: 2, reps: '45 s' },
      { id: CID.side, name: 'Side Plank', sets: 2, reps: '25–30 s per side' },
    ],
    [
      sessionExercise(CID.bike, 'Cycling', [f.cardio(540, 'warmup')], 'completed'),
      sessionExercise(
        CID.press,
        '45° Leg Press',
        f.strength([
          [12, 130, 8],
          [12, 135, 8],
          [12, 135, 9],
          [16, 135, 9.5],
        ]),
        'in_progress',
      ),
    ],
  );
  const history = historyOf([
    {
      id: CID.press,
      name: '45° Leg Press',
      planned: '4×12',
      past: [
        [
          '2026-09-27',
          p.strength([
            [12, 110],
            [12, 130, 8],
            [12, 130, 8],
            [12, 135, 9],
          ]),
        ],
        [
          '2026-09-21',
          p.strength([
            [12, 110],
            [12, 110],
            [12, 120],
            [12, 120, 9],
          ]),
        ],
        [
          '2026-09-16',
          [
            p.warmup(10, 80),
            ...p.strength([
              [12, 110],
              [12, 110],
              [12, 110, 9],
            ]),
          ],
        ],
      ],
    },
    {
      id: CID.ext,
      name: 'Leg Extension',
      planned: '3×15',
      past: [
        [
          '2026-09-27',
          p.strength([
            [15, 66, 7],
            [15, 66, 9],
            [15, 66, 8],
          ]),
        ],
        [
          '2026-09-21',
          p.strength([
            [12, 66],
            [12, 66],
            [12, 66],
          ]),
        ],
        [
          '2026-09-16',
          p.strength([
            [12, 59, 7],
            [12, 59, 7],
            [12, 59, 7],
          ]),
        ],
      ],
    },
    {
      id: CID.curl,
      name: 'Leg Curl',
      planned: '3×15',
      past: [
        [
          '2026-09-27',
          p.strength([
            [15, 66, 7],
            [15, 66, 9],
            [15, 66, 9],
          ]),
        ],
        [
          '2026-09-21',
          p.strength([
            [12, 66],
            [12, 66],
            [12, 66],
          ]),
        ],
        [
          '2026-09-16',
          p.strength([
            [12, 59, 7],
            [12, 59, 7],
            [12, 59, 7],
          ]),
        ],
      ],
    },
    {
      id: CID.calf,
      name: 'Standing Calf Raise Machine',
      planned: '3×25–30',
      past: [
        [
          '2026-09-27',
          p.strength([
            [30, 40],
            [30, 40],
            [30, 45, 9],
            [30, 45, 10],
          ]),
        ],
        [
          '2026-09-21',
          p.strength([
            [20, 50],
            [15, 50],
            [12, 50, 10],
          ]),
        ],
        [
          '2026-04-24',
          p.strength([
            [20, 60, 7],
            [25, 70, 8],
          ]),
        ],
      ],
    },
    {
      id: CID.plank,
      name: 'Plank',
      planned: '2×45 s',
      past: [
        ['2026-09-29', p.holds([45, 45])],
        ['2026-09-27', p.holds([45, 45])],
        ['2026-09-21', p.holds([45, 45])],
      ],
    },
    {
      id: CID.side,
      name: 'Side Plank',
      planned: '2×25–30 s per side',
      past: [
        ['2026-09-27', p.holds([30, 30])],
        ['2026-09-21', p.holds([30, 30])],
        ['2026-09-16', p.holds([25, 25, 25, 25])],
      ],
    },
    {
      id: CID.bike,
      name: 'Cycling',
      planned: null,
      past: [['2026-09-10', [p.cardio(600)]]],
    },
  ]);
  const turns: Array<[string, string]> = [
    [
      'проехал 9 минут на велосипеде для разминки',
      'Confirmed the 9-minute cycling warm-up; for the leg press advised a light set of 12 at 90–100 kg, then working sets of 135 kg × 12 (lighter option 130 kg × 12).',
    ],
    [
      'ты говорил начать 130 потом 135 так как на самом деле?',
      'Admitted the two messages differed and settled on 135 kg × 12 for working sets after a warm-up set, with 130 kg × 12 as the lighter option.',
    ],
    [
      'но я уже сделал первый подход 130 на 12 как ты говорил сначала',
      'Confirmed set 1 as 12 × 130 kg; said set 2 could be 130 or 135 kg by feel and asked how many more reps he could have done.',
    ],
    [
      'я не знаю, может 2 может 3',
      'Recorded set 1 as RPE 8 (2–3 reps left) and advised 135 kg × 12 for set 2, back to 130 kg if it feels heavy.',
    ],
    [
      '135х12 рпе 8',
      'Confirmed set 2 as 12 × 135 kg, RPE 8, noted it felt easier than the same set on Sunday (RPE 9), and advised 135 kg × 12 for sets 3 and 4.',
    ],
    [
      'еще подход на 12 повторов вес тот же рпе 9',
      'Confirmed set 3 as 12 × 135 kg, RPE 9, calling all three sets 135 kg (set 1 was 130), and advised 135 kg × 12 for the last set (130 kg if very tired).',
    ],
    [
      'повтори, какие подходы как ты записал?',
      'Listed the leg-press sets: 12×130 RPE 8, 12×135 RPE 8, 12×135 RPE 9; set 4 still to do.',
    ],
    [
      'ты сказал все 3 на 135, но это не так',
      'Agreed it had misspoken (two sets at 135, one at 130; the log is correct) and advised 135 kg × 12 for set 4, 130 kg as the lighter option.',
    ],
  ];
  return {
    name: 'case07',
    now,
    timezone: 'Asia/Manila',
    user: { id: 'u1', firstName: null, fitnessLevel: 'intermediate', languageCode: 'ru', timezone: 'Asia/Manila' },
    data: {
      session,
      history,
      lastWorkout: { completedAt: long('2026-09-29'), exerciseNames: ['Treadmill', 'Chest-Supported Row', 'Plank'] },
      warmupHabit: {
        workouts: 10,
        withCardio: 9,
        kinds: [
          { label: 'treadmill', minMinutes: 10, maxMinutes: 15 },
          { label: 'bike', minMinutes: 8, maxMinutes: 8 },
        ],
      },
      reportedToday: [],
      coachReplied: true,
      profileFacts: [
        factOf(
          1,
          'physical_constraint',
          'Lower back: dull heaviness, no acute pain; no heavy axial loading (deadlift, barbell squat, RDL, bent-over row).',
          'lower_back',
        ),
        factOf(2, 'equipment', 'Prefers machines and cables; for core, short endurance holds rather than loaded work.'),
        factOf(3, 'schedule_constraint', 'Sessions last 45–50 minutes.'),
        factOf(4, 'schedule_constraint', 'Upper/lower split, about five sessions a week, no fixed days.'),
        factOf(5, 'coaching_preference', 'Reports effort as RPE himself.'),
        factOf(6, 'exercise_preference', "45° leg press: the sled's own weight (unknown) adds to the plates."),
      ],
    },
    history: workoutMessages(turns, []),
    current: new HumanMessage({ content: 'сделал последний подход 135х16 рпе 9 или ближе к 10', id: 'cur' }),
  };
}

export const PLAIN_FIXTURE = plainFixture;
export const CASE07_FIXTURE = case07Fixture;

// ---------------------------------------------------------------- assembly

export interface RequestSection {
  name: string;
  chars: number;
  tokens: number;
}

export interface TrainingRequest {
  messages: BaseMessage[];
  sections: RequestSection[];
  /** Everything the model reads as text (system + context + messages), without the tool schemas. */
  totalChars: number;
  totalTokens: number;
  toolSchemaChars: number;
  coachChars: number;
}

const section = (name: string, text: string): RequestSection => ({
  name,
  chars: text.length,
  tokens: estimateTokens(text),
});

const textOf = (m: BaseMessage): string => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));

/** What `agent.node.ts` sends for a `memory: 'workout'` phase, over the fixture's data. */
export async function assembleTrainingRequest(fx: RequestFixture): Promise<TrainingRequest> {
  const stubDeps = {
    userService: {},
    userFacts: {},
    trainingService: {},
    exerciseRepository: {},
    embeddingService: {},
    workoutSessionRepo: {},
  } as unknown as ConversationGraphDeps;
  const spec = buildTrainingSpec(stubDeps);
  const renderCtx = {
    now: fx.now,
    timezone: fx.timezone,
    client: 'telegram' as const,
    user: fx.user,
    lastMessageTime: null,
  };
  const sections = spec.prompt.current.render({ ...renderCtx, ...fx.data } as never);
  const systemPrompt = compose(sections);
  const nowLine = renderBlock(CURRENT_TIME_V1, renderCtx);
  const current = [fx.current];

  const { messages } = await assembleContext({
    systemPrompt,
    userFacts: [],
    courseDirective: null,
    episodeSummaries: [],
    contextBlocks: spec.contextBlocks,
    blockData: fx.data,
    history: workoutHistory(fx.history, current),
    current,
    gapNote: null,
    nowLine,
    budget: spec.budget,
    cacheWarm: null,
    now: fx.now,
    timezone: fx.timezone,
    user: fx.user,
  });

  const blockCtx = { now: fx.now, timezone: fx.timezone, user: fx.user };
  const rendered = Object.fromEntries(
    (spec.contextBlocks ?? []).map(b => [b.id, b.render(fx.data as never, blockCtx, b.depths?.[0] ?? 0) ?? '']),
  );
  const [system, ...rest] = messages;
  const last = rest[rest.length - 1];
  const parts = Array.isArray(last?.content) ? (last.content as Array<{ type: string; text?: string }>) : [];
  const contextText = parts[0]?.text ?? '';
  const userText = parts
    .slice(1)
    .map(p => p.text ?? '')
    .join('');
  const prior = rest.slice(0, -1);
  const coach = sections.find(s => s.id === 'coach')?.text ?? '';
  const profile = sections.find(s => s.id === 'profile')?.text ?? '';
  const today = rendered['training.today'] ?? '';
  const hist = rendered['training.history'] ?? '';

  const out: RequestSection[] = [
    section('system: coach prompt', coach),
    section('system: # Profile', profile),
    section('context: # Today', today),
    section('context: # History', hist),
    section('context: NOW line', nowLine),
    section('this workout messages (before the current)', prior.map(textOf).join('')),
    section('client message now', userText),
  ];
  const totalChars =
    textOf(system as BaseMessage).length +
    contextText.length +
    prior.reduce((n, m) => n + textOf(m).length, 0) +
    userText.length;
  const toolSchemaChars = spec.tools.reduce((n, t) => n + JSON.stringify(convertToOpenAITool(t)).length, 0);
  return {
    messages,
    sections: out,
    totalChars,
    totalTokens: estimateMessages(messages),
    toolSchemaChars,
    coachChars: coach.length,
  };
}
