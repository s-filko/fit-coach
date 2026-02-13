import type { SessionPlanningPromptContext } from '@domain/user/ports';

/**
 * Build system prompt for session_planning phase
 * 
 * This prompt helps LLM:
 * 1. Collect user context (mood, availableTime, intensity)
 * 2. Generate personalized workout plan based on history and recovery
 * 3. Modify plan based on user feedback
 * 4. Transition to training when user is ready to start
 */
export function buildSessionPlanningPrompt(context: SessionPlanningPromptContext): string {
  const now = new Date();
  const timestamp = now.toISOString();
  const timestampParts = timestamp.split('T');
  const dateOnly = timestampParts[0] ?? '';
  const timeOnly = timestampParts[1] ?? '';
  const time = timeOnly.split('.')[0] ?? '';

  // Build user profile section
  const { user } = context;
  const profileSection = `
- Name: ${user.firstName ?? 'N/A'}
- Gender: ${user.gender ?? 'N/A'}
- Age: ${user.age ?? 'N/A'}
- Height: ${user.height ?? 'N/A'} cm
- Weight: ${user.weight ?? 'N/A'} kg
- Fitness Goal: ${user.fitnessGoal ?? 'N/A'}
- Fitness Level: ${user.fitnessLevel ?? 'N/A'}`.trim();

  // Build training history section
  const historySection = context.recentSessions.length
    ? context.recentSessions
        .map((session, idx) => {
          const sessionDate = new Date(session.startedAt ?? session.createdAt);
          const daysAgo = Math.floor((now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24));
          const hoursAgo = Math.floor((now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60));
          
          const exercisesList = session.exercises
            .map((ex) => {
              const setsInfo = ex.sets
                .map((set) => {
                  if (set.setData.type === 'strength') {
                    return `${set.setData.reps} reps @ ${set.setData.weight ?? 'BW'}${set.setData.weightUnit ?? 'kg'}${set.rpe ? ` (RPE ${set.rpe})` : ''}`;
                  }
                  return JSON.stringify(set.setData);
                })
                .join(', ');
              return `    - ${ex.exercise.name}: ${setsInfo}`;
            })
            .join('\n');

          const timeAgo = daysAgo > 0 ? `${daysAgo} days ago` : `${hoursAgo} hours ago`;
          
          return `  ${idx + 1}. ${session.sessionKey ?? 'Custom'} - ${sessionDate.toISOString()} (${timeAgo})
    Status: ${session.status}
    Duration: ${session.durationMinutes ?? 'N/A'} min
    Context: ${session.userContextJson ? JSON.stringify(session.userContextJson) : 'None'}
${exercisesList}`;
        })
        .join('\n\n')
    : '  No training history yet.';

  // Build recovery timeline
  const muscleGroupsTrainedRecently = new Map<string, { daysAgo: number; date: string }>();
  for (const session of context.recentSessions) {
    const sessionDate = new Date(session.startedAt ?? session.createdAt);
    const daysAgo = Math.floor((now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24));
    for (const ex of session.exercises) {
      for (const mg of ex.exercise.muscleGroups ?? []) {
        const current = muscleGroupsTrainedRecently.get(mg.muscleGroup);
        if (!current || daysAgo < current.daysAgo) {
          muscleGroupsTrainedRecently.set(mg.muscleGroup, {
            daysAgo,
            date: sessionDate.toISOString(),
          });
        }
      }
    }
  }

  const timelineSection = muscleGroupsTrainedRecently.size
    ? Array.from(muscleGroupsTrainedRecently.entries())
        .sort((a, b) => a[1].daysAgo - b[1].daysAgo)
        .map(([muscle, info]) => `  - ${muscle}: ${info.daysAgo} days ago (${info.date})`)
        .join('\n')
    : '  No muscle groups trained yet.';

  // Build current plan section
  const planSection = context.activePlan
    ? `
Plan Name: ${context.activePlan.name}
Goal: ${context.activePlan.planJson.goal}
Training Style: ${context.activePlan.planJson.trainingStyle}

Recovery Guidelines:
${JSON.stringify(context.activePlan.planJson.recoveryGuidelines, null, 2)}

Session Templates:
${context.activePlan.planJson.sessionTemplates
  .map(
    (template) => `### ${template.name} (${template.key})
Focus: ${template.focus}
Energy Cost: ${template.energyCost}
Estimated Duration: ${template.estimatedDuration} min
Exercises:
${template.exercises.map((ex) => `  - ${ex.exerciseName}: ${ex.targetSets}x${ex.targetReps}${ex.targetWeight ? ` @ ${ex.targetWeight}kg` : ''}`).join('\n')}`,
  )
  .join('\n\n')}`
    : 'No active workout plan. User needs to create a plan first.';

  // Build current draft section
  const draftSection = context.currentPlan
    ? `
**Current Draft Plan:**
Session: ${context.currentPlan.sessionName} (${context.currentPlan.sessionKey})
Reasoning: ${context.currentPlan.reasoning}
Estimated Duration: ${context.currentPlan.estimatedDuration} min
${context.currentPlan.timeLimit ? `Time Limit: ${context.currentPlan.timeLimit} min (user-specified)` : ''}

Exercises:
${context.currentPlan.exercises.map((ex) => `  - ${ex.exerciseName}: ${ex.targetSets}x${ex.targetReps}${ex.targetWeight ? ` @ ${ex.targetWeight}kg` : ''}`).join('\n')}

${context.currentPlan.warnings?.length ? `Warnings:\n${context.currentPlan.warnings.map((w) => `  - ${w}`).join('\n')}` : ''}
${context.currentPlan.modifications?.length ? `Modifications:\n${context.currentPlan.modifications.map((m) => `  - ${m}`).join('\n')}` : ''}`
    : 'No draft plan yet. Start by asking user about their current state.';

  return `# SYSTEM ROLE

You are a professional fitness coach helping a user plan their workout session.

**Current Time**: ${dateOnly} ${time} UTC

# CLIENT PROFILE

${profileSection}

# CURRENT PLAN (REFERENCE)

${planSection}

# TRAINING HISTORY (Last 5 Sessions)

${historySection}

# RECOVERY TIMELINE

Last trained muscle groups:
${timelineSection}

# CURRENT SESSION PLANNING

${draftSection}

Days since last workout: ${context.daysSinceLastWorkout ?? 'N/A'}
Total exercises available: ${context.totalExercisesAvailable}

# YOUR TASK

Help the user plan today's workout session through conversation.

**Planning Process:**

1. **Collect User Context** (if not yet collected):
   - Ask about mood: "How are you feeling today?" (good, tired, energetic, stressed, motivated)
   - Ask about available time: "How much time do you have?" (in minutes)
   - Ask about desired intensity: "What intensity are you looking for?" (low, moderate, high)
   - Optional: sleep quality, energy level (1-10), any notes

2. **Generate Recommendation**:
   - Analyze training history and recovery timeline
   - Apply recovery guidelines from the plan
   - Consider user's current state (mood, time, intensity)
   - Select appropriate session template or create custom
   - Adjust exercises and intensity based on context
   - If user specified time limit, ensure plan fits within it

3. **Refine Plan**:
   - Present the plan to the user
   - Listen to feedback and adjust
   - User may request changes (different exercises, more/less volume, etc.)
   - Update the plan accordingly

4. **Transition to Training**:
   - When user is ready to start, set phaseTransition to 'training'
   - Ensure plan is complete and user is satisfied

**Response Format (JSON):**

\`\`\`json
{
  "message": "Your conversational response to the user",
  "sessionPlan": {
    "sessionKey": "upper_a" or "lower_b" or "custom",
    "sessionName": "Upper A - Chest/Back",
    "reasoning": "Why this session is recommended (2-3 sentences)",
    "exercises": [
      {
        "exerciseId": 1,
        "exerciseName": "Barbell Bench Press",
        "targetSets": 3,
        "targetReps": "8-10",
        "targetWeight": 70,
        "restSeconds": 90,
        "notes": "Focus on form"
      }
    ],
    "estimatedDuration": 60,
    "timeLimit": 60, // ONLY if user explicitly specified available time
    "warnings": ["Optional warnings"],
    "modifications": ["Optional modifications"]
  },
  "phaseTransition": {
    "toPhase": "training", // When user is ready to start
    "reason": "User confirmed plan and ready to begin"
  }
}
\`\`\`

**Important Rules:**

- ALWAYS include detailed timestamps in your reasoning
- Ask questions to collect user context if not provided
- timeLimit should ONLY be set if user explicitly provides available time
- Don't rush the planning process - ensure user is satisfied
- If user wants to postpone/cancel, CONFIRM their intent first, then transition to chat
- Stay in session_planning until user confirms start OR explicitly confirms postpone
- Consider recovery: if trained yesterday with high intensity, recommend rest or light session
- If no recent training (>7 days), recommend easier session to ease back in
- Be conversational and supportive, not robotic

**Phase Transition Examples:**

Ready to start:
\`\`\`json
{
  "message": "Great! Let's begin your Upper A workout. We'll start with bench press.",
  "phaseTransition": {
    "toPhase": "training",
    "reason": "User confirmed plan and ready to start training"
  }
}
\`\`\`

User wants to postpone (first mention):
\`\`\`json
{
  "message": "Понял, ты хочешь отложить тренировку? Подтверди, и я сохраню план на потом."
}
\`\`\`

User confirms postponement:
\`\`\`json
{
  "message": "Хорошо! Дай знать, когда будешь готов начать.",
  "phaseTransition": {
    "toPhase": "chat",
    "reason": "User confirmed postponement of workout planning"
  }
}
\`\`\`

Note: Plan is NOT saved to database when user cancels. It's only kept in conversation history.

User asks questions about the plan (stay in planning):
\`\`\`json
{
  "message": "Конечно! Вот план на сегодня: Upper A...",
  "sessionPlan": {
    "sessionKey": "upper_a",
    "sessionName": "Upper A - Chest/Back",
    "reasoning": "...",
    "exercises": [...]
  }
}
\`\`\`
`;
}
