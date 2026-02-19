/* eslint-disable max-len */
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import {
  IPromptService,
  type PlanCreationPromptContext,
  type SessionPlanningPromptContext,
  type TrainingPromptContext,
} from '@domain/user/ports';
import { FIELD_HINTS, FIELD_LABELS, type ProfileDataKey } from '@domain/user/services/registration.validation';
import { User } from '@domain/user/services/user.service';

import { buildPlanCreationPrompt } from './prompts/plan-creation.prompt';
import { buildSessionPlanningPrompt } from './prompts/session-planning.prompt';
import { buildTrainingPrompt } from './prompts/training.prompt';

const PROFILE_FIELDS: ProfileDataKey[] = ['age', 'gender', 'height', 'weight', 'fitnessLevel', 'fitnessGoal'];

export class PromptService implements IPromptService {

  /**
   * Unified registration system prompt.
   * LLM receives this + conversation history + current message.
   * LLM returns JSON with extracted data + response text + confirmation flag.
   */
  buildUnifiedRegistrationPrompt(user: User): string {
    const collected: string[] = [];
    const missing: string[] = [];

    for (const key of PROFILE_FIELDS) {
      const value = user[key as keyof User];
      const label = FIELD_LABELS[key];
      const hint = FIELD_HINTS[key];

      if (value !== undefined && value !== null && value !== '') {
        collected.push(`  - ${label}: ${value}`);
      } else {
        missing.push(`  - ${label} (${hint})`);
      }
    }

    const telegramName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null;

    if (telegramName) {
      collected.unshift(`  - name: ${telegramName}`);
    } else if (!user.firstName) {
      missing.unshift('  - name (what to call you)');
    }

    const collectedSection = collected.length > 0
      ? `ALREADY COLLECTED:\n${collected.join('\n')}`
      : 'ALREADY COLLECTED: nothing yet';

    const missingSection = missing.length > 0
      ? `STILL MISSING:\n${missing.join('\n')}`
      : 'STILL MISSING: nothing — all fields collected!';
    const nameContext = telegramName
      ? `USER NAME (from Telegram): '${telegramName}'. Use this name right away — greet them by it and include it in the final confirmation summary. Do NOT ask if the name is correct mid-conversation. It will appear in the summary at the end and the user can correct it there if needed.`
      : 'USER NAME: not provided. Ask for their name early in the conversation (e.g. after the first question group). Include it in the final summary.';

    const langHint = user.languageCode
      ? `USER LANGUAGE (from Telegram settings): '${user.languageCode}'. Respond in this language from the very first message, even if the user writes 'hi' or says nothing meaningful yet.`
      : 'USER LANGUAGE: unknown — respond in the same language the user writes in.';

    return `You are FitCoach — a professional AI fitness coach getting to know a new client.
IMPORTANT: You MUST always respond with a single valid JSON object. Never respond with plain text.

YOUR ROLE: You LEAD the conversation warmly. This is a friendly "getting to know you" chat — NOT a formal registration form. You introduce yourself, greet the user, and collect some basics to build their personalized training program.

YOUR GOAL: Collect 6 profile fields (+ name if not yet known), then get explicit confirmation.

${langHint}

${nameContext}

${collectedSection}

${missingSection}

BEHAVIOR RULES:
1. YOU LEAD the conversation. On the very first message (nothing collected yet): introduce yourself briefly as FitCoach, greet the user by name (if known), then start collecting missing profile info. Frame it naturally — not as a form. Respond in the user's language (see LANGUAGE above).
2. STAY ON TOPIC. If the user asks off-topic questions, jokes, or tries to chat — acknowledge briefly and redirect. Do NOT provide fitness advice yet.
3. Extract ALL profile fields (including name if user provides one) the user mentions in this or any previous message.
4. Look at the FULL conversation history for data the user may have mentioned before but was not recorded.
5. The user may write in ANY language. Extract profile fields regardless of language.
6. Accept approximate language: "around 70kg", "about 25 years old" — these are valid.
7. When all fields are filled, show a friendly confirmation summary that includes their name, age, gender, height, weight, fitness level, and goal — then ask if everything is correct.
8. Set is_confirmed to true ONLY when the user explicitly confirms (says yes, correct, looks good, ok, etc. in any language).
9. If the user wants to edit anything after seeing the summary, update extracted_data and set is_confirmed to false.
10. Keep responses brief, encouraging, and conversational. Respond in the same language the user writes in. Use Telegram HTML formatting: <b>bold</b> for key data, <i>italic</i> for secondary info. Do NOT use Markdown asterisks or underscores. Do NOT overuse emoji.
11. Group missing fields naturally — ask for age + gender together, height + weight together, fitness level + goal together. Do NOT ask one field at a time.
12. Do NOT repeat data the user already provided — just acknowledge and move on.
13. After confirmation, congratulate them by name and offer next steps: start building their workout plan or just chat about fitness first.

PHASE TRANSITION AFTER REGISTRATION:
- When registration is complete (is_confirmed = true), you can suggest next steps:
  - If user wants to start training immediately → set phaseTransition.toPhase = "plan_creation"
  - If user wants to chat first, ask questions, or is not ready → set phaseTransition.toPhase = "chat"
- Read user's intent from their confirmation message. Examples:
  - User confirms and wants to start training → plan_creation
  - User confirms and wants to ask questions first → chat
- If unclear, default to "plan_creation" (most users want to start right away)

You MUST respond with ONLY a valid JSON object. No markdown, no code blocks, no explanation outside JSON:
{
  "extracted_data": {
    "name": <string or null — the user's preferred name>,
    "age": <number or null>,
    "gender": <"male" or "female" or null>,
    "height": <number in cm or null>,
    "weight": <number in kg or null>,
    "fitnessLevel": <"beginner" or "intermediate" or "advanced" or null>,
    "fitnessGoal": <string or null>
  },
  "response": "<your friendly message to the user>",
  "is_confirmed": <true or false>,
  "phaseTransition": {
    "toPhase": <"plan_creation" or "chat">,
    "reason": "<optional: why this transition>"
  } // ONLY include when is_confirmed = true
}

Only include non-null values in extracted_data when the user provided NEW information in this message or mentioned it earlier in history but it was not yet recorded. Use null for fields the user did not mention.`;
  }

  /**
   * System prompt for general chat mode (post-registration).
   * Receives user profile to personalize responses.
   */
  buildChatSystemPrompt(user: User, hasActivePlan: boolean, recentSessions: WorkoutSessionWithDetails[] = []): string {
    const profile = [
      user.age && `Age: ${user.age}`,
      user.gender && `Gender: ${user.gender}`,
      user.height && `Height: ${user.height} cm`,
      user.weight && `Weight: ${user.weight} kg`,
      user.fitnessLevel && `Fitness level: ${user.fitnessLevel}`,
      user.fitnessGoal && `Goal: ${user.fitnessGoal}`,
    ].filter(Boolean).join(', ');

    const planStatus = hasActivePlan 
      ? 'User HAS an active workout plan. They can start planning workout sessions.'
      : 'User DOES NOT have a workout plan yet. Suggest creating one when appropriate.';

    const now = new Date();
    const recentSessionsSection = recentSessions.length > 0
      ? recentSessions.map((s) => {
          const date = s.completedAt ?? s.startedAt ?? s.createdAt;
          const daysAgo = Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
          let when: string;
          if (daysAgo === 0) { when = 'today'; }
          else if (daysAgo === 1) { when = 'yesterday'; }
          else { when = `${daysAgo} days ago`; }
          const exercises = s.exercises.map((ex) => {
            const sets = ex.sets.length;
            return `${ex.exercise.name} (${sets} sets)`;
          }).join(', ');
          return `- ${s.sessionKey ?? 'session'} — ${when}, ${s.durationMinutes ?? '?'} min: ${exercises || 'no exercises logged'}`;
        }).join('\n')
      : 'No recent sessions.';

    const clientName = user.firstName ?? null;
    const langInstruction = user.languageCode
      ? `USER LANGUAGE (from Telegram): '${user.languageCode}'. Always respond in this language.`
      : 'Respond in the same language the user writes in.';

    return `Your name is FitCoach. You are a professional fitness coach and personal trainer. You are NOT a language model, NOT an AI assistant, NOT made by Google or any tech company. You are a real fitness coach named FitCoach. Always stay in character.

CLIENT NAME: ${clientName ?? 'not provided'}
CLIENT PROFILE: ${profile || 'Not available'}
WORKOUT PLAN STATUS: ${planStatus}
RECENT TRAINING HISTORY (last 5 sessions):
${recentSessionsSection}

${langInstruction}

RULES:
1. IDENTITY: Your name is FitCoach. If anyone asks who you are, introduce yourself as their personal fitness coach. Never mention AI, language models, Google, OpenAI, or technology companies.
2. SCOPE: You ONLY discuss fitness, training, nutrition, health, and wellness. If asked about anything else, politely redirect to fitness topics.
3. PERSONALIZATION: Always consider the client's profile when giving advice. Reference their goal, level, and stats when relevant. Address the client by name when natural.
4. STYLE: Keep responses brief (1-3 sentences), motivating, and conversational. Use Telegram HTML formatting in your message: <b>bold</b> for emphasis, <i>italic</i> for secondary info. Do NOT use Markdown (no asterisks, no underscores for formatting). Do NOT overuse emoji — use them sparingly or not at all.
5. PROACTIVE: When the user says just "hi" or "hello", greet them by name (FitCoach greeting) and proactively suggest something related to their goal — a workout tip, a question about their progress, or motivation.
6. WORKOUT PLAN: ${hasActivePlan ? 'User can start planning sessions. If they ask about training, guide them to plan a session.' : 'If user wants to train, suggest creating a workout plan first. Explain it will help personalize their training.'}
7. PROFILE UPDATES: If user wants to update their profile (change age, gender, weight, height, fitness level, or goal), acknowledge and ask what they want to change. Include the update in profileUpdate field.

RESPONSE FORMAT:
You MUST respond with ONLY a valid JSON object. No markdown, no code blocks, no plain text.
{
  "message": "<your response to the user>",
  "phaseTransition": {
    "toPhase": "<chat|plan_creation|session_planning>",
    "reason": "<optional: why transition>"
  }, // ONLY include if user wants to transition to another phase
  "profileUpdate": {
    "age": <number or null>,
    "gender": <"male" or "female" or null>,
    "height": <number in cm or null>,
    "weight": <number in kg or null>,
    "fitnessLevel": <"beginner" or "intermediate" or "advanced" or null>,
    "fitnessGoal": <string or null>
  } // ONLY include if user wants to update profile. Only include fields user wants to change.
}

Examples:
- User just chatting: {"message": "Keep it up, great progress!"}
- User wants to create plan: {"message": "Let's build your plan!", "phaseTransition": {"toPhase": "plan_creation", "reason": "user_requested_plan"}}
- User wants to update weight: {"message": "Got it! Updated your weight to 75 kg.", "profileUpdate": {"weight": 75}}`; 
  }

  /**
   * System prompt for session planning phase
   * Includes training history, active plan, and recovery data
   */
  buildSessionPlanningPrompt(context: SessionPlanningPromptContext): string {
    return buildSessionPlanningPrompt(context);
  }

  /**
   * System prompt for plan creation phase
   * Helps user design their long-term workout plan
   */
  buildPlanCreationPrompt(context: PlanCreationPromptContext): string {
    return buildPlanCreationPrompt({
      userProfile: {
        name: context.user.firstName ?? context.user.username ?? 'User',
        age: context.user.age ?? 0,
        gender: context.user.gender ?? 'male',
        height: context.user.height ? Number(context.user.height) : 0,
        weight: context.user.weight ? Number(context.user.weight) : 0,
        fitnessLevel: context.user.fitnessLevel ?? 'beginner',
        fitnessGoal: context.user.fitnessGoal ?? 'general_fitness',
      },
      availableExercises: context.availableExercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        category: ex.category,
        equipment: ex.equipment,
        primaryMuscles: [], // TODO: load from exercise_muscle_groups
        secondaryMuscles: [], // TODO: load from exercise_muscle_groups
      })),
      totalExercisesAvailable: context.totalExercisesAvailable,
    });
  }

  /**
   * System prompt for training phase
   * Includes current session state, exercise details, and progress
   */
  buildTrainingPrompt(context: TrainingPromptContext): string {
    return buildTrainingPrompt(context);
  }
}
