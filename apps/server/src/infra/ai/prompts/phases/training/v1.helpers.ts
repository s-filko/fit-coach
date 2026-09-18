import type { WorkoutSessionWithDetails } from '@domain/training/types';

/**
 * Moved verbatim from graph/nodes/training.node.ts private helpers (P2, AC-1321).
 * buildStaleSessionSection's trailing "\n\n" is trimmed by the caller — the section
 * separator comes from compose() instead.
 */

/**
 * Single source of truth for the LLM about what has been done and what is planned.
 *
 * Structure:
 *   SESSION GUIDE   — full plan with live status markers
 *   EXERCISE DETAIL — sets for in_progress and completed exercises only
 *   ACTIVE STATUS   — explicit "what can be done right now" line
 */
export function buildWorkoutOverview(session: WorkoutSessionWithDetails, now: Date): string {
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

export function buildPreviousSessionSection(session: WorkoutSessionWithDetails): string {
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
    case 'cardio_distance': {
      const durStr = setData.duration > 0 ? `${Math.round(setData.duration / 60)}min` : '?min';
      const parts: string[] = [`${setData.distance}${setData.distanceUnit}`, durStr];
      if (setData.inclinePct != null) {
        parts.push(`${setData.inclinePct}% incline`);
      }
      return parts.join(' ');
    }
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

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 24) {
    return `${hours} hours`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day(s)`;
}

export function buildStaleSessionSection(sessionAgeMs: number): string {
  return `=== STALE SESSION ===

This session has been inactive for ${formatDuration(sessionAgeMs)}.
Retro-logging is active: any sets you log will be timestamped to the original training time, not now.

RULES:
1. ANALYZE the user's message carefully:
   - If they want to ADD data to this session (extra sets, missed exercises, corrections)
     → use log_set / complete_current_exercise as usual. The system automatically timestamps retro-sets to the original training time.
     → After logging, ask: "Anything else to add, or shall we close this session?"
   - If they want to START a new workout, chat casually, or do anything unrelated to this session
     → call finish_training first to close this stale session, then respond normally.
2. NEVER auto-close the session without asking the user first.
3. If ambiguous, ASK: "Are you adding to the previous session or starting fresh?"
`;
}
