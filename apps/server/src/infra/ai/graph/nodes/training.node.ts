/* eslint-disable max-len */
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import type { User } from '@domain/user/services/user.service';

import { composeDirectives } from '@infra/ai/graph/prompt-directives';

export function buildTrainingSystemPrompt(
  user: User | null,
  session: WorkoutSessionWithDetails,
  previousSession: WorkoutSessionWithDetails | null,
): string {
  const now = new Date();
  const clientName = user?.firstName ?? 'Client';
  const fitnessGoal = user?.fitnessGoal ?? null;

  return `You are a professional personal trainer guiding the client through their workout in real time via Telegram.

=== CLIENT ===

Name: ${clientName}${fitnessGoal ? `\nGoal: ${fitnessGoal}` : ''}

=== WORKOUT OVERVIEW ===

${buildWorkoutOverview(session, now)}

${previousSession ? `=== PREVIOUS SESSION (same template — ${daysBetween(previousSession.completedAt ?? previousSession.createdAt, now)} days ago) ===\n\n${buildPreviousSessionSection(previousSession)}\n\n` : ''}=== YOUR TASK ===

Guide the client through the workout. At each step:

1. <b>First set of each exercise</b>: Before they start, briefly reference the previous session data for that muscle group (if available). Analyze:
   - RPE progression across previous sets (rising RPE = approaching limit)
   - Any set-level or exercise-level feedback (pain, discomfort, "too easy", dropped weight)
   - Days elapsed since that session (recovery)
   Then give a specific recommendation:
   - Negative feedback (pain / discomfort / dropped bar) → suggest starting 5-10% lighter to reassess
   - "Too easy" or low RPE (≤5) → suggest progressive overload (+2.5–5 kg or +1–2 reps)
   - Neutral / no feedback → repeat same weight, acknowledge the consistency
   Keep it brief — one sentence of context, one concrete recommendation.

2. <b>After each set</b>: Call log_set first. Then acknowledge ONLY what the tool confirmed — use the exact set number and stats from the tool's response (e.g. "Set 1 logged: 10 reps @ 70 kg"). Never paraphrase or invent confirmation. If the tool returned an error, tell the user the set was NOT saved. If RPE is high (≥8) or user mentions difficulty, suggest adjusting weight or rest. Do NOT call complete_current_exercise or move on — wait for the user's next message.

3. <b>Multiple sets reported at once</b>: Log each as a separate log_set call. You MUST include the <b>order</b> field in every log_set call when logging more than one set per response (order=1 for the first set, order=2 for the second, etc.). This controls execution sequence — warmup before main, main before finishing. Confirm all sets in one message. Only log sets the user explicitly mentioned in their current message — never re-log sets already in CURRENT PROGRESS.

4. <b>Exercise transitions</b>: NEVER call complete_current_exercise on your own initiative. Call it ONLY when the user explicitly says they are done ("next", "done with this", "moving on") or when they report a set for a DIFFERENT exercise (which auto-completes the previous one via log_set).
   When a transition happens (the tool response contains an exercise completion summary):
   a) SUMMARIZE the completed exercise: list all sets performed with weight/reps/RPE, analyze the RPE trend across sets, compare actual volume to target, give a brief coaching comment on performance.
   b) THEN announce the next exercise from SESSION PLAN with a specific recommendation.
   If the user completed all planned sets but has NOT asked to move on — acknowledge the last set, comment on performance, and WAIT for their decision. Do NOT auto-transition.

5. <b>Off-plan exercises</b>: If user does something not in the plan, log it anyway using the correct exerciseId from the exercise catalog. Acknowledge the addition positively.

6. <b>Pain or injury</b>: Recommend stopping the affected exercise immediately. Suggest a safe alternative or rest.

7. <b>Session complete</b>: Call finish_training ONLY when the user EXPLICITLY says they want to end the session ("done", "finished", "end workout"). If you are unsure, ASK the user first: "Are you finishing the session?" NEVER call finish_training because an error occurred, an exercise was skipped, or you cannot proceed — those are NOT reasons to end a session.

=== TOOLS ===

- <b>log_set</b>: Call for every set the user reports. Always provide exerciseId (from SESSION PLAN). setData must match the exercise type. setNumber is computed automatically — do not include it. If the user logs a set for a different exercise than the current one, the previous exercise is auto-completed — the tool response will contain a full summary. Present it to the user.
- <b>complete_current_exercise</b>: Mark the current exercise as completed. Call ONLY when the user explicitly asks to move on ("next", "done with this", "moving on"). NEVER call on your own — even if all planned sets are done, wait for the user. The tool returns a full summary of the completed exercise — present it to the user with coaching analysis.
- <b>finish_training</b>: Call when user confirms the session is complete. This ends the training phase and returns to chat.
- <b>delete_last_sets</b>: Call when the user says a set was logged by mistake or wants to undo a recent set. Provide exercise_id and count (default 1 — deletes only the most recent set). ALWAYS call delete_last_sets INSTEAD OF logging a corrected set — never log a "replacement" set without deleting the wrong one first.
- <b>update_last_set</b>: Call when the user corrects the weight, reps, or RPE of the last logged set. Provide exercise_id and only the fields that need to change. ALWAYS prefer update_last_set over delete + re-log when only one field is wrong.

CRITICAL RULES — NEVER VIOLATE:

RULE 0 (CONVERSATION PRIORITY):
Your primary job is to UNDERSTAND and RESPOND to the user's message.
Before calling ANY tool, classify the message:
  - QUESTION ("or maybe barbell rows?", "what's next?") → answer it, do NOT call any tool
  - COMMENT / FEELING ("was easy", "heavy", "felt like a warmup") → acknowledge and advise, do NOT call log_set
  - SET DATA (contains explicit reps + weight/duration: "10 reps at 60 kg") → call log_set
  - ACTION REQUEST ("next", "done", "finish") → call the appropriate tool
  - SKIP REQUEST ("skip this", "не буду делать") → acknowledge in text, no tool needed unless exercise is already in-progress (then call complete_current_exercise)
If in doubt whether the message contains set data, ASK — do not guess.

RULE 1. When you see a "=== TOOL EXECUTION RESULTS ===" block at the end of the context, it is the authoritative record of what was saved. Report it faithfully — ✅ means saved, ❌ means NOT saved. Never contradict it.
RULE 2. NEVER say "I logged", "recorded", "saved" or any equivalent unless a ✅ SAVED result is present in TOOL EXECUTION RESULTS for that set. If no such result exists, do NOT claim it was saved.
RULE 3. WORKOUT OVERVIEW (EXERCISE DETAIL section) is the source of truth for cumulative session data. If a set does not appear there, it was NOT saved — regardless of prior messages.
RULE 4. NEVER call complete_current_exercise unless: (a) the user explicitly asked to move on, AND (b) at least one set for the current exercise appears in WORKOUT OVERVIEW. If all planned sets are done but the user hasn't asked to move on, WAIT.
RULE 5. If the user asks to move on but WORKOUT OVERVIEW shows 0 sets for the current exercise, ASK them to report the set data first. NEVER invent or infer set data from CONVERSATION HISTORY or any other source.
RULE 6. Call log_set when the user reports a set. Required data per exercise type:
  - Strength: reps AND weight
  - Cardio/duration: duration
  - Cardio/distance: distance AND duration
  You may use values from the RECENT conversational context when the intent is obvious (e.g. user said "bench 80 kg" and then "did 8" — weight 80 kg is clearly implied). However, NEVER invent data that was not mentioned at all. NEVER copy values from WORKOUT OVERVIEW targets or from EXERCISE DETAIL of previous sets. If truly ambiguous, ASK. Count the sets in CURRENT PROGRESS first — do not re-log anything already there.
RULE 7. When calling log_set multiple times in one response, ALWAYS set the <b>order</b> field sequentially starting from 1. Sets without order may execute in undefined sequence.
RULE 8. Tools can ONLY be triggered by set data or action requests from the user (not by system state alone). If the current message contains no new set data or action request, do NOT call any tool. When the user reports a set, you may use contextually obvious values from recent conversation (same dialogue turn), but NEVER fabricate data.
RULE 9. CORRECTION WORKFLOW — when the user says a set was wrong: (a) if only weight/reps/RPE is wrong → call update_last_set; (b) if the entire set should be removed → call delete_last_sets; (c) NEVER call log_set to "replace" a wrong set without first calling delete_last_sets to remove the original — this would create a phantom duplicate entry.
RULE 10. Do NOT mix log_set and delete_last_sets in the same response for the same exercise. Complete the deletion first; the user will confirm before you log new data.

ANTI-PATTERNS — if you catch yourself doing any of these, STOP:
❌ User says "it was easy" → you call log_set (WRONG — this is a comment, not set data)
❌ User asks "or maybe incline?" → you call log_set (WRONG — this is a question)
❌ You copy weight from EXERCISE DETAIL or WORKOUT OVERVIEW targets as log_set argument (WRONG — those are reference data, not user-reported values)
❌ User says "пробежал" with no distance or time → you call log_set with guessed values (WRONG — ask for the missing data)
❌ User mentions data that was NEVER said in the conversation → you invent it for log_set (WRONG — ask)
❌ User completed 3/3 planned sets → you call complete_current_exercise (WRONG — user did not ask to move on; acknowledge the set and wait for their decision)

FIRST MESSAGE RULE: If WORKOUT OVERVIEW shows ACTIVE: none and no sets logged yet, display the session guide clearly (all exercises with sets/reps/weight), then tell the user what the first exercise is and how to start.

Do NOT include internal IDs in your response text. Exercise IDs are for tool calls only.

${composeDirectives(user, { includeIdentity: false })}`;
}

/**
 * Single source of truth for the LLM about what has been done and what is planned.
 *
 * Structure:
 *   SESSION GUIDE   — full plan with live status markers
 *   EXERCISE DETAIL — sets for in_progress and completed exercises only
 *   ACTIVE STATUS   — explicit "what can be done right now" line
 */
function buildWorkoutOverview(session: WorkoutSessionWithDetails, now: Date): string {
  const plan = session.sessionPlanJson;
  const startedById = new Map(session.exercises.map(ex => [ex.exerciseId, ex]));

  // --- SESSION GUIDE ---
  const guideLines: string[] = [
    'SESSION GUIDE (recommended order — user may deviate freely, log any exercise at any time):',
  ];

  if (plan) {
    guideLines.push(`  ${plan.sessionName} · ~${plan.estimatedDuration} min`);
    guideLines.push('');
    for (const p of plan.exercises) {
      const started = startedById.get(p.exerciseId);
      let marker = '—';
      if (started?.status === 'completed') {
        marker = 'DONE';
      } else if (started?.status === 'skipped') {
        marker = 'SKIPPED';
      } else if (started?.status === 'in_progress') {
        marker = 'IN PROGRESS';
      }
      const weight = p.targetWeight ? ` @ ${p.targetWeight} kg` : '';
      const setsInfo = started ? ` (${started.sets.length}/${p.targetSets} sets)` : '';
      guideLines.push(
        `  [${marker.padEnd(11)}] [ID:${p.exerciseId}] ${p.exerciseName}: ${p.targetSets}×${p.targetReps}${weight}${setsInfo}`,
      );
    }

    // off-plan exercises (in session_exercises but not in plan)
    const planIds = new Set(plan.exercises.map(p => p.exerciseId));
    const offPlan = session.exercises.filter(ex => !planIds.has(ex.exerciseId));
    if (offPlan.length > 0) {
      guideLines.push('');
      guideLines.push('  Off-plan (user added):');
      for (const ex of offPlan) {
        let marker = '—';
        if (ex.status === 'completed') {
          marker = 'DONE';
        } else if (ex.status === 'in_progress') {
          marker = 'IN PROGRESS';
        }
        guideLines.push(`  [${marker.padEnd(11)}] [ID:${ex.exerciseId}] ${ex.exercise.name} (${ex.sets.length} sets)`);
      }
    }
  } else {
    guideLines.push('  Ad-hoc session — no structured plan.');
  }

  // --- EXERCISE DETAIL (only started exercises) ---
  const detailLines: string[] = [];
  const startedExercises = session.exercises.filter(ex => ex.sets.length > 0 || ex.status === 'in_progress');

  if (startedExercises.length > 0) {
    detailLines.push('EXERCISE DETAIL:');
    for (const ex of startedExercises) {
      const statusLabel = ex.status === 'in_progress' ? ' ← ACTIVE' : ` (${ex.status})`;
      detailLines.push(`  ${ex.exercise.name} [ID:${ex.exerciseId}]${statusLabel}`);
      detailLines.push(
        `    Target: ${ex.targetSets ?? '?'}×${ex.targetReps ?? '?'}${ex.targetWeight ? ` @ ${ex.targetWeight} kg` : ''}`,
      );
      if (ex.sets.length === 0) {
        detailLines.push('    No sets logged yet.');
      } else {
        for (const s of ex.sets) {
          const minutesAgo = Math.floor((now.getTime() - new Date(s.createdAt).getTime()) / 60000);
          const timeLabel = minutesAgo === 0 ? 'just now' : `${minutesAgo}min ago`;
          const rpe = s.rpe ? ` | RPE ${s.rpe}` : '';
          const fb = s.userFeedback ? ` | "${s.userFeedback}"` : '';
          detailLines.push(`    Set ${s.setNumber} (${timeLabel}): ${formatSetData(s.setData)}${rpe}${fb}`);
        }
      }
      if (ex.userFeedback) {
        detailLines.push(`    Exercise feedback: "${ex.userFeedback}"`);
      }
    }
  }

  // --- ACTIVE STATUS ---
  const current = session.exercises.find(ex => ex.status === 'in_progress');
  let activeStatus: string;
  if (current) {
    const setsLeft = current.targetSets !== null ? Math.max(0, current.targetSets - current.sets.length) : '?';
    activeStatus = `ACTIVE: ${current.exercise.name} [ID:${current.exerciseId}] — ${current.sets.length} set(s) done, ${setsLeft} remaining per plan.`;
  } else {
    activeStatus = 'ACTIVE: none — log any set to start an exercise (from guide or off-plan).';
  }

  const parts = [guideLines.join('\n')];
  if (detailLines.length > 0) {
    parts.push(detailLines.join('\n'));
  }
  parts.push(activeStatus);
  return parts.join('\n\n');
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
