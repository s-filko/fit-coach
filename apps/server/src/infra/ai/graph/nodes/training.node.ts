/* eslint-disable max-len, @typescript-eslint/explicit-function-return-type */
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import type { User } from '@domain/user/services/user.service';

export function buildTrainingSystemPrompt(
  user: User | null,
  session: WorkoutSessionWithDetails,
  previousSession: WorkoutSessionWithDetails | null,
): string {
  const now = new Date();
  const clientName = user?.firstName ?? 'Client';
  const fitnessGoal = user?.fitnessGoal ?? null;

  return `You are a professional personal trainer guiding ${clientName} through their workout in real time via Telegram.

=== CLIENT ===

Name: ${clientName}${fitnessGoal ? `\nGoal: ${fitnessGoal}` : ''}

=== SESSION PLAN ===

${buildSessionPlanSection(session)}

=== CURRENT PROGRESS ===

${buildProgressSection(session, now)}

=== CURRENT EXERCISE ===

${buildCurrentExerciseSection(session)}

${previousSession ? `=== PREVIOUS SESSION (same template — ${daysBetween(previousSession.completedAt ?? previousSession.createdAt, now)} days ago) ===\n\n${buildPreviousSessionSection(previousSession)}\n\n` : ''}=== YOUR TASK ===

Guide ${clientName} through the workout. At each step:

1. <b>First set of each exercise</b>: Before they start, briefly reference the previous session data for that muscle group (if available). Analyze:
   - RPE progression across previous sets (rising RPE = approaching limit)
   - Any set-level or exercise-level feedback (pain, discomfort, "too easy", dropped weight)
   - Days elapsed since that session (recovery)
   Then give a specific recommendation:
   - Negative feedback (pain / discomfort / dropped bar) → suggest starting 5-10% lighter to reassess
   - "Too easy" or low RPE (≤5) → suggest progressive overload (+2.5–5 kg or +1–2 reps)
   - Neutral / no feedback → repeat same weight, acknowledge the consistency
   Keep it brief — one sentence of context, one concrete recommendation.

2. <b>After each set</b>: Call log_set first. Then acknowledge ONLY what the tool confirmed — use the exact set number and stats from the tool's response (e.g. "Set 1 logged: 10 reps @ 70 kg"). Never paraphrase or invent confirmation. If the tool returned an error, tell the user the set was NOT saved. If RPE is high (≥8) or user mentions difficulty, suggest adjusting weight or rest.

3. <b>Multiple sets reported at once</b>: Log each as a separate log_set call. You MUST include the <b>order</b> field in every log_set call when logging more than one set per response (order=1 for the first set, order=2 for the second, etc.). This controls execution sequence — warmup before main, main before finishing. Confirm all sets in one message. Only log sets the user explicitly mentioned in their current message — never re-log sets already in CURRENT PROGRESS.

4. <b>When exercise is done</b>: Call next_exercise. Tell the user the next exercise and what to target.

5. <b>Off-plan exercises</b>: If user does something not in the plan, log it anyway using the correct exerciseId from the exercise catalog. Acknowledge the addition positively.

6. <b>Pain or injury</b>: Recommend stopping the affected exercise immediately. Suggest a safe alternative or rest.

7. <b>Session complete</b>: When all exercises are done or user says "done" / "finished" → call finish_training.

=== TOOLS ===

- <b>log_set</b>: Call for every set the user reports. Always provide exerciseId (from SESSION PLAN). setData must match the exercise type. setNumber is computed automatically — do not include it.
- <b>next_exercise</b>: Call when the user finishes all sets of the current exercise and is ready to move on. Do NOT call it to start the very first exercise of the session.
- <b>skip_exercise</b>: Call when user explicitly wants to skip the current exercise.
- <b>finish_training</b>: Call when user confirms the session is complete. This ends the training phase and returns to chat.

CRITICAL RULES — NEVER VIOLATE:
1. When you see a "=== TOOL EXECUTION RESULTS ===" block at the end of the context, it is the authoritative record of what was saved. Report it faithfully — ✅ means saved, ❌ means NOT saved. Never contradict it.
2. NEVER say "I logged", "recorded", "saved" or any equivalent unless a ✅ SAVED result is present in TOOL EXECUTION RESULTS for that set. If no such result exists, do NOT claim it was saved.
3. CURRENT PROGRESS is the source of truth for cumulative session data. If a set does not appear there, it was NOT saved — regardless of prior messages.
4. NEVER call next_exercise unless at least one set for the current exercise appears in CURRENT PROGRESS.
5. If the user asks to move on but CURRENT PROGRESS shows 0 sets, call log_set first, then next_exercise.
6. Call log_set ONLY for sets explicitly reported in the user's current message. Count the sets in CURRENT PROGRESS first — do not re-log anything already there.
7. When calling log_set multiple times in one response, ALWAYS set the <b>order</b> field sequentially starting from 1. Sets without order may execute in undefined sequence.
8. CONVERSATION HISTORY is memory only — it shows past exchanges for context. NEVER call any tool based on data from CONVERSATION HISTORY. Tools (log_set, next_exercise, skip_exercise, finish_training) can ONLY be triggered by the user's current message. If the current message contains no new set data or action request, do NOT call any tool.

FIRST MESSAGE RULE: If CURRENT PROGRESS shows "No exercises started yet", display the full workout plan clearly (all exercises with sets/reps/weight), then tell the user what the first exercise is and how to start.

=== FORMATTING ===

Use Telegram HTML: <b>bold</b> for exercise names and key data, <i>italic</i> for tips or secondary info.
Do NOT use Markdown (no **bold**, no _italic_).
Respond in the user's language (detected from their messages). Never use Russian or any other language unless the user writes in it.
Do NOT include JSON or internal IDs in your response text. Exercise IDs are for tool calls only.`;
}

function buildSessionPlanSection(session: WorkoutSessionWithDetails): string {
  const plan = session.sessionPlanJson;
  if (!plan) {
    return 'Ad-hoc session — no structured plan.';
  }

  const lines: string[] = [
    `Session: ${plan.sessionName} (key: ${plan.sessionKey})`,
    `Estimated duration: ${plan.estimatedDuration} min`,
    '',
    'Exercises:',
  ];

  for (const ex of plan.exercises) {
    const weight = ex.targetWeight ? ` @ ${ex.targetWeight} kg` : '';
    lines.push(
      `  [ID:${ex.exerciseId}] ${ex.exerciseName}: ${ex.targetSets}×${ex.targetReps}${weight} (rest: ${ex.restSeconds}s)`,
    );
  }

  return lines.join('\n');
}

function buildProgressSection(session: WorkoutSessionWithDetails, now: Date): string {
  if (session.exercises.length === 0) {
    return 'No exercises started yet.';
  }

  return session.exercises
    .map(ex => {
      const header = `${ex.exercise.name} — ${ex.status.toUpperCase()}`;
      const target = `  Target: ${ex.targetSets ?? '?'}×${ex.targetReps ?? '?'}${ex.targetWeight ? ` @ ${ex.targetWeight} kg` : ''}`;

      if (ex.sets.length === 0) {
        return `${header}\n${target}\n  No sets logged yet.`;
      }

      const setsText = ex.sets.map(s => {
        const minutesAgo = Math.floor((now.getTime() - new Date(s.createdAt).getTime()) / 60000);
        const timeLabel = minutesAgo === 0 ? 'just now' : `${minutesAgo}min ago`;
        const base = formatSetData(s.setData);
        const rpe = s.rpe ? ` | RPE ${s.rpe}` : '';
        const fb = s.userFeedback ? ` | "${s.userFeedback}"` : '';
        return `  Set ${s.setNumber} (${timeLabel}): ${base}${rpe}${fb}`;
      });

      const exerciseFb = ex.userFeedback ? `\n  Exercise feedback: "${ex.userFeedback}"` : '';
      return `${header}\n${target}\n${setsText.join('\n')}${exerciseFb}`;
    })
    .join('\n\n');
}

function buildCurrentExerciseSection(session: WorkoutSessionWithDetails): string {
  const current = session.exercises.find(ex => ex.status === 'in_progress');
  if (!current) {
    return 'No exercise currently in progress.';
  }

  const setsLeft = current.targetSets !== null ? Math.max(0, current.targetSets - current.sets.length) : '?';

  return [
    `${current.exercise.name} [ID:${current.exerciseId}]`,
    `Target: ${current.targetSets ?? '?'}×${current.targetReps ?? '?'}${current.targetWeight ? ` @ ${current.targetWeight} kg` : ''}`,
    `Sets done: ${current.sets.length} | Sets remaining: ${setsLeft}`,
  ].join('\n');
}

function buildPreviousSessionSection(session: WorkoutSessionWithDetails): string {
  if (session.exercises.length === 0) {
    return 'No exercise data from previous session.';
  }

  return session.exercises
    .map(ex => {
      const header = `${ex.exercise.name} [ID:${ex.exerciseId}]`;
      if (ex.sets.length === 0) {
        return `${header}\n  No sets logged.`;
      }

      const setsText = ex.sets.map(s => {
        const base = formatSetData(s.setData);
        const rpe = s.rpe ? ` | RPE ${s.rpe}` : '';
        const fb = s.userFeedback ? ` | "${s.userFeedback}"` : '';
        return `  Set ${s.setNumber}: ${base}${rpe}${fb}`;
      });

      const exerciseFb = ex.userFeedback ? `\n  Overall feedback: "${ex.userFeedback}"` : '';
      return `${header}\n${setsText.join('\n')}${exerciseFb}`;
    })
    .join('\n\n');
}

function formatSetData(setData: WorkoutSessionWithDetails['exercises'][number]['sets'][number]['setData']): string {
  switch (setData.type) {
    case 'strength':
      return `${setData.reps} reps${setData.weight != null ? ` @ ${setData.weight} ${setData.weightUnit ?? 'kg'}` : ''}`;
    case 'cardio_distance':
      return `${setData.distance} ${setData.distanceUnit} in ${setData.duration}s`;
    case 'cardio_duration':
      return `${setData.duration}s${setData.intensity ? ` (${setData.intensity})` : ''}`;
    case 'functional_reps':
      return `${setData.reps} reps`;
    case 'isometric':
      return `${setData.duration}s hold`;
    case 'interval':
      return `${setData.rounds ?? 1} rounds: ${setData.workDuration}s on / ${setData.restDuration}s off`;
    default:
      return JSON.stringify(setData);
  }
}

function daysBetween(date: Date | null | string, now: Date): number {
  if (!date) {
    return 0;
  }
  const ms = now.getTime() - new Date(date).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
