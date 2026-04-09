import type { UserProfile, WorkoutPlan, WorkoutSessionWithDetails } from '@domain/training/types';
import { calendarDaysAgo, formatInUserTz, humanTimeAgo } from '@shared/date-utils';

export async function buildSessionRecommendationPrompt(
  user: UserProfile,
  plan: WorkoutPlan,
  recentSessions: WorkoutSessionWithDetails[],
): Promise<string> {
  const now = new Date();
  const { dateOnly: today } = formatInUserTz(now);

  // Build training history section
  const historySection = recentSessions.length
    ? recentSessions
        .map((session, idx) => {
          const exercisesList = session.exercises
            .map(ex => {
              const setsInfo = ex.sets
                .map(set => {
                  if (set.setData.type === 'strength') {
                    return `${set.setData.reps} reps @ ${set.setData.weight ?? 'BW'}${set.setData.weightUnit ?? 'kg'}${set.rpe ? ` (RPE ${set.rpe})` : ''}`;
                  }
                  return JSON.stringify(set.setData);
                })
                .join(', ');
              return `    - ${ex.exercise.name}: ${setsInfo}`;
            })
            .join('\n');

          return `  ${idx + 1}. ${session.sessionKey ?? 'Custom'} - ${humanTimeAgo(new Date(session.startedAt ?? session.createdAt), now)} (${session.status})
    Duration: ${session.durationMinutes ?? 'N/A'} min
    Context: ${session.userContextJson ? JSON.stringify(session.userContextJson) : 'None'}
${exercisesList}`;
        })
        .join('\n\n')
    : '  No training history yet.';

  // Build timeline analysis
  const muscleGroupsTrainedRecently = new Map<string, { daysAgo: number; date: Date }>();
  for (const session of recentSessions) {
    const sessionDate = new Date(session.startedAt ?? session.createdAt);
    const daysAgo = calendarDaysAgo(sessionDate, now);
    for (const ex of session.exercises) {
      for (const mg of ex.exercise.muscleGroups ?? []) {
        const current = muscleGroupsTrainedRecently.get(mg.muscleGroup);
        if (!current || daysAgo < current.daysAgo) {
          muscleGroupsTrainedRecently.set(mg.muscleGroup, { daysAgo, date: sessionDate });
        }
      }
    }
  }

  const timelineSection = muscleGroupsTrainedRecently.size
    ? Array.from(muscleGroupsTrainedRecently.entries())
        .sort((a, b) => a[1].daysAgo - b[1].daysAgo)
        .map(([muscle, info]) => `  - ${muscle}: ${humanTimeAgo(info.date, now)}`)
        .join('\n')
    : '  No muscle groups trained yet.';

  return `# CLIENT PROFILE

- Gender: ${user.gender ?? 'N/A'}
- Age: ${user.age ?? 'N/A'}
- Height: ${user.height ?? 'N/A'} cm
- Weight: ${user.weight ?? 'N/A'} kg
- Fitness Goal: ${user.fitnessGoal ?? 'N/A'}
- Fitness Level: ${user.fitnessLevel ?? 'N/A'}

# CURRENT PLAN (REFERENCE)

Plan Name: ${plan.name}
Goal: ${plan.planJson.goal}
Training Style: ${plan.planJson.trainingStyle}

## Recovery Guidelines

${JSON.stringify(plan.planJson.recoveryGuidelines, null, 2)}

## Session Templates

${plan.planJson.sessionTemplates
  .map(
    template => `### ${template.name} (${template.key})
Focus: ${template.focus}
Energy Cost: ${template.energyCost}
Estimated Duration: ${template.estimatedDuration} min
Exercises:
${template.exercises.map(ex => `  - [ID:${ex.exerciseId}] ${ex.exerciseName}: ${ex.targetSets}x${ex.targetReps}${ex.targetWeight ? ` @ ${ex.targetWeight}kg` : ''} (rest: ${ex.restSeconds}s)`).join('\n')}`,
  )
  .join('\n\n')}

# TRAINING HISTORY (Last 5 Sessions)

${historySection}

# TIMELINE ANALYSIS

Last trained muscle groups:
${timelineSection}

# TODAY'S CONTEXT

Date: ${today}
Days since last workout: ${recentSessions.length ? calendarDaysAgo(recentSessions[0].startedAt ?? recentSessions[0].createdAt, now) : 'N/A'}

# YOUR TASK

Analyze the training history and recommend the BEST session for today.

**Important:**
- The plan is a REFERENCE, not a strict schedule
- User may have deviated from the plan - analyze ACTUAL history
- Use recovery guidelines to assess muscle group readiness
- Consider user's fitness level and recent training intensity
- If no recent training, recommend an easy session to ease back in
- If user trained yesterday with high intensity, consider rest or low-intensity cardio
- CRITICAL: exerciseId MUST be the EXACT UUID shown as [ID:...] in the Session Templates above. NEVER invent or guess IDs.

**Response Format (JSON):**

{
  "sessionKey": "upper_a" or "lower_b" or "custom",
  "sessionName": "Upper A - Chest/Back",
  "reasoning": "Detailed explanation of why this session is recommended (2-3 sentences)",
  "exercises": [
    {
      "exerciseId": "<exercise-uuid>",
      "exerciseName": "Barbell Bench Press",
      "targetSets": 3,
      "targetReps": "8-10",
      "targetWeight": 70,
      "restSeconds": 90,
      "notes": "Focus on form, increase weight if hitting 10 reps easily"
    }
  ],
  "estimatedDuration": 60,
  "warnings": ["Optional warning if user is at risk of overtraining"],
  "modifications": ["Optional modifications to the template if needed"]
}

**Analysis Steps:**
1. Check days since last workout for each major muscle group
2. Compare against recovery guidelines
3. Identify which muscle groups are recovered
4. Select appropriate session template or create custom
5. Adjust intensity based on recent training load and user feedback (RPE, context)
6. Provide clear reasoning for your recommendation
`;
}
