# Muscle-Centric Exercise History

## Problem

History is currently looked up by `sessionKey` (workout template name). Any plan change resets history to null. The user does not think in templates — they think in exercises and muscles.

## Two context levels

### Level 1 — Session Planning (deciding WHAT to do)

LLM sees overall fatigue/recovery picture across all muscle groups. Both primary and secondary involvement are included — LLM uses involvement type to judge actual recovery needs.

Format: JSON in system prompt.

```json
{
  "muscleStatus": [
    { "muscle": "chest", "daysAgo": 3, "sets": 9, "involvement": "primary" },
    { "muscle": "triceps", "daysAgo": 3, "sets": 9, "involvement": "secondary" },
    { "muscle": "triceps", "daysAgo": 7, "sets": 6, "involvement": "primary" },
    { "muscle": "quads", "daysAgo": 12, "sets": 8, "involvement": "primary" }
  ]
}
```

LLM decides: "Quads haven't been trained in 12 days — priority today."

### Level 2 — Training (deciding HOW to do current exercise)

LLM sees muscle dynamics for the current `in_progress` exercise — all exercises that target the same **primary muscles**, sorted by freshness. Exact match (same exercise) is prioritized over similar (same muscles, different exercise).

Lookup key: primary muscles of the current exercise (not exercise ID, not session key).

Format: JSON in system prompt.

```json
{
  "currentMuscles": ["chest", "triceps", "shoulders_front"],
  "history": [
    {
      "exercise": "Barbell Bench Press",
      "match": "exact",
      "sessions": [
        {
          "daysAgo": 3,
          "sets": [
            { "reps": 10, "weight": 70, "rpe": 6 },
            { "reps": 10, "weight": 75, "rpe": 7 },
            { "reps": 8, "weight": 75, "rpe": 9 },
            { "reps": 6, "weight": 75, "rpe": 9 }
          ]
        },
        {
          "daysAgo": 10,
          "sets": [
            { "reps": 10, "weight": 70, "rpe": 5 },
            { "reps": 10, "weight": 70, "rpe": 6 },
            { "reps": 10, "weight": 70, "rpe": 7 }
          ]
        }
      ]
    },
    {
      "exercise": "Dumbbell Press",
      "match": "similar",
      "primaryMuscle": "chest",
      "sessions": [
        {
          "daysAgo": 5,
          "sets": [
            { "reps": 12, "weight": 24, "rpe": 6 },
            { "reps": 12, "weight": 24, "rpe": 7 },
            { "reps": 10, "weight": 24, "rpe": 7 }
          ]
        }
      ]
    }
  ]
}
```

History updates automatically on each user message — `agentNode` checks which exercise is currently `in_progress` and fetches history for its primary muscles. When exercise changes via `complete_current_exercise`, the next user message gets fresh history.

No "previous session" block. Only current session progress + exercise history for current muscles.

## New types (`domain/training/types.ts`)

```typescript
export interface ExerciseSetHistory {
  setNumber: number;
  reps?: number;
  weight?: number;
  weightUnit?: string;
  duration?: number;
  rpe: number | null;
  feedback: string | null;
}

export interface ExerciseSessionHistory {
  exerciseId: number;
  exerciseName: string;
  sessionDate: Date;
  daysSince: number;
  matchType: 'exact' | 'primary_muscle';
  sets: ExerciseSetHistory[];
}

export interface MuscleGroupFatigue {
  muscleGroup: MuscleGroup;
  involvement: Involvement; // 'primary' | 'secondary'
  lastTrainedAt: Date;
  daysSince: number;
  totalSets: number;
}
```

## New repository methods (`IWorkoutSessionRepository`)

### `getMuscleGroupFatigue(userId)`

Aggregation across all completed sessions. Returns both primary and secondary involvement — LLM uses involvement to judge recovery.

```sql
SELECT
  emg.muscle_group,
  emg.involvement,
  MAX(ws.completed_at) as last_trained_at,
  COUNT(ss.id) as total_sets
FROM session_exercises se
JOIN workout_sessions ws ON ws.id = se.session_id
  AND ws.user_id = $userId AND ws.status = 'completed'
JOIN exercise_muscle_groups emg ON emg.exercise_id = se.exercise_id
JOIN session_sets ss ON ss.session_exercise_id = se.id
GROUP BY emg.muscle_group, emg.involvement
```

### `getExerciseHistory(userId, exerciseId, primaryMuscles, opts)`

Two queries:

1. **Exact match** — `session_exercises` where `exercise_id = exerciseId` from completed sessions, top 3 by date
2. **Similar** — `session_exercises` where exercise has overlapping primary muscles (via `exercise_muscle_groups`), top 2-3 within 30 days, excluding the exact exercise

For each match: load all sets.

Return combined list: exact first, then similar, each sorted by freshness.

## New service methods (`ITrainingService`)

```typescript
getMuscleReadiness(userId: string): Promise<MuscleGroupFatigue[]>

getExerciseHistoryByMuscles(
  userId: string,
  exerciseId: number,
  primaryMuscles: MuscleGroup[]
): Promise<ExerciseSessionHistory[]>
```

`getMuscleReadiness` delegates to repository.

`getExerciseHistoryByMuscles` fetches history for a single exercise's muscle group — called per exercise, not batched. Called from `agentNode` on each message for the current `in_progress` exercise.

## Prompt changes

- [`session-planning.node.ts`](apps/server/src/infra/ai/graph/nodes/session-planning.node.ts) — add `=== MUSCLE STATUS ===` section with JSON from `getMuscleReadiness`
- [`training.node.ts`](apps/server/src/infra/ai/graph/nodes/training.node.ts):
  - Remove `previousSession` parameter
  - Add `exerciseHistory: ExerciseSessionHistory[]` parameter (for current exercise only)
  - Replace `=== PREVIOUS SESSION ===` with `=== EXERCISE HISTORY ===` containing JSON
  - Remove `buildPreviousSessionSection`
- [`training.subgraph.ts`](apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts):
  - In `agentNode`: find current `in_progress` exercise, get its primary muscles, call `getExerciseHistoryByMuscles`
  - Remove `findLastCompletedByUserAndKey` call
- [`session-planning.subgraph.ts`](apps/server/src/infra/ai/graph/subgraphs/session-planning.subgraph.ts) — add `getMuscleReadiness` to context

## Cleanup

- Remove `findLastCompletedByUserAndKey` from repository ports and implementation

## Implementation order (TDD)

1. New types in `types.ts`
2. Repository methods + SQL + integration tests
3. Service methods + unit tests
4. Update `training.subgraph.ts` and `training.node.ts`
5. Update `session-planning.subgraph.ts` and `session-planning.node.ts`
6. Remove `findLastCompletedByUserAndKey`
