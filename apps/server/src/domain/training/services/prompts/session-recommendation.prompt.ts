import type { UserProfile, WorkoutPlan, WorkoutSessionWithDetails } from '@domain/training/types';

export async function buildSessionRecommendationPrompt(
  user: UserProfile,
  plan: WorkoutPlan,
  recentSessions: WorkoutSessionWithDetails[],
): Promise<string> {
  const [today] = new Date().toISOString().split('T');

  // Build training history section
  const historySection = recentSessions.length
    ? recentSessions
        .map((session, idx) => {
          const daysAgo = Math.floor(
            (Date.now() - (session.startedAt ?? session.createdAt).getTime()) / (1000 * 60 * 60 * 24),
          );
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

          return `  ${idx + 1}. ${session.sessionKey ?? 'Custom'} - ${daysAgo} days ago (${session.status})
    Duration: ${session.durationMinutes ?? 'N/A'} min
    Context: ${session.userContextJson ? JSON.stringify(session.userContextJson) : 'None'}
${exercisesList}`;
        })
        .join('\n\n')
    : '  No training history yet.';

  // Build timeline analysis
  const muscleGroupsTrainedRecently = new Map<string, number>();
  for (const session of recentSessions) {
    const daysAgo = Math.floor(
      (Date.now() - (session.startedAt ?? session.createdAt).getTime()) / (1000 * 60 * 60 * 24),
    );
    for (const ex of session.exercises) {
      for (const mg of ex.exercise.muscleGroups ?? []) {
        const current = muscleGroupsTrainedRecently.get(mg.muscleGroup);
        if (!current || daysAgo < current) {
          muscleGroupsTrainedRecently.set(mg.muscleGroup, daysAgo);
        }
      }
    }
  }

  const timelineSection = muscleGroupsTrainedRecently.size
    ? Array.from(muscleGroupsTrainedRecently.entries())
        .sort((a, b) => a[1] - b[1])
        .map(([muscle, days]) => `  - ${muscle}: ${days} days ago`)
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
${template.exercises.map(ex => `  - ${ex.exerciseName}: ${ex.targetSets}x${ex.targetReps}${ex.targetWeight ? ` @ ${ex.targetWeight}kg` : ''}`).join('\n')}`,
  )
  .join('\n\n')}

# TRAINING HISTORY (Last 5 Sessions)

${historySection}

# TIMELINE ANALYSIS

Last trained muscle groups:
${timelineSection}

# TODAY'S CONTEXT

Date: ${today}
Days since last workout: ${recentSessions.length ? Math.floor((Date.now() - (recentSessions[0].startedAt ?? recentSessions[0].createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 'N/A'}

# YOUR TASK

Analyze the training history and recommend the BEST session for today.

**Important:**
- The plan is a REFERENCE, not a strict schedule
- User may have deviated from the plan - analyze ACTUAL history
- Use recovery guidelines to assess muscle group readiness
- Consider user's fitness level and recent training intensity
- If no recent training, recommend an easy session to ease back in
- If user trained yesterday with high intensity, consider rest or low-intensity cardio

**Response Format (JSON):**

{
  "sessionKey": "upper_a" or "lower_b" or "custom",
  "sessionName": "Upper A - Chest/Back",
  "reasoning": "Detailed explanation of why this session is recommended (2-3 sentences)",
  "exercises": [
    {
      "exerciseId": 1,
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
