/**
 * AC-1343 fixture (P4 context-budget plan Task 4): a 60-turn training
 * transcript — human report → log_set tool call → tool result → ai
 * acknowledgement, repeated — realistic lengths so `estimateMessages` sees a
 * transcript that meaningfully accumulates tokens across many turns. Seeded
 * into the `messages` channel via `bindSeedMessages` + `toBaseMessages`
 * (`evals/lib/seed-messages.ts`), the same path production seeding uses.
 */
import type { StateMessage } from '../schema/case.schema';
import { bindSeedMessages } from '../schema/case.schema';

// IDs must match evals/lib/build-stub-deps.ts's CATALOG (log_set validates exerciseId as a UUID
// resolved through findByIds) — real UUIDs, not placeholder strings, so the stub tool succeeds.
const EXERCISES = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Жим лёжа (штанга)' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Тяга штанги в наклоне' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Жим гантелей сидя' },
];

const TURN_COUNT = 60;

function turn(n: number): StateMessage[] {
  const exercise = EXERCISES[n % EXERCISES.length];
  const reps = 6 + (n % 5);
  const weight = 40 + (n % 10) * 2.5;
  return [
    {
      role: 'human',
      text: `Сделал подход ${n + 1} на ${exercise.name.toLowerCase()}: ${reps} повторений с весом ${weight} кг, RPE ${5 + (n % 4)}. Чувствую себя нормально, продолжаю тренировку.`,
    },
    {
      role: 'tool_call',
      name: 'log_set',
      args: { exerciseId: exercise.id, reps, weight, rpe: 5 + (n % 4) },
    },
    {
      role: 'tool_result',
      text: `Set ${n + 1} logged: ${reps} reps @ ${weight} kg (RPE ${5 + (n % 4)}) for ${exercise.name}.`,
    },
    {
      role: 'ai',
      text: `Отлично, подход ${n + 1} записан: ${reps} повторений с весом ${weight} кг по ${exercise.name}. Продолжаем в том же темпе — следующий подход, когда будешь готов.`,
    },
  ];
}

/** 60 turns × 4 messages = 240 seed messages, unbound tool_call/tool_result ids resolved by bindSeedMessages. */
export const LONG_TRAINING_TRANSCRIPT: StateMessage[] = bindSeedMessages(
  Array.from({ length: TURN_COUNT }, (_, i) => turn(i)).flat(),
);
