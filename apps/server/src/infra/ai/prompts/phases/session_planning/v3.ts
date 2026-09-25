import type { SessionPlanningContextData } from '@domain/training/services/session-planning-context.builder';

import { renderDirectives } from '@infra/ai/prompts/compose';
import { DEFAULT_DIRECTIVES_V2 } from '@infra/ai/prompts/directives';
import type { DirectiveContext, PromptModule, Section } from '@infra/ai/prompts/types';

/**
 * v3 (transition-handoff plan Task 7, BUG-032): `date` keeps its
 * days-since-last-workout line but drops `Current Date: YYYY-MM-DD` —
 * duplicated by the new `directive.current-time` (DEFAULT_DIRECTIVES_V2,
 * last directive), which also gives a time and weekday. Everything else
 * renders the exact wording v2 rendered for it.
 *
 * v3 amendment (transition-handoff plan Task 5, AC-TH-7 negative half,
 * still before v3 ever shipped): STEP 5 gains one sentence — past-day sets
 * ("вчера делал 110×12") are history, never a session start or today's
 * `log_set`.
 */
export interface SessionPlanningPromptContextV3 extends DirectiveContext {
  /** Only what `date`'s days-since line needs — the rest of SessionPlanningContextData moved to blocks. */
  context: Pick<SessionPlanningContextData, 'daysSinceLastWorkout'>;
}

const TASK_TEXT = `=== YOUR TASK ===

Follow this sequence:

--- STEP 1: INTERNAL ANALYSIS (think through this before responding) ---

Using the ACTIVE WORKOUT PLAN (session templates) and RECOVERY TIMELINE above:
a) For each session template, look at its exercises and identify the primary muscle groups they target.
b) Cross-reference with the RECOVERY TIMELINE to find when those muscle groups were last trained.
c) Rank templates by how long their primary muscles have been resting — longest gap = highest priority candidate.
d) If the top candidate has primary muscles trained <2 days ago, move to the next.
e) NEGLECT OVERRIDE: If a template's primary muscles have not been trained for 10+ days, that template gets TOP PRIORITY regardless of fitness goal. Long neglect causes muscle loss and imbalance — address it first. If the client has concerns (soreness, injury, joint issues after a long break), adapt intensity (reduce weights, add warm-up sets) but still recommend that template.
f) If multiple templates are equally recovered AND none triggers the neglect override, apply GOAL PRIORITY: choose the one that best serves the client's fitnessGoal. Example: goal "V-silhouette / wide shoulders" → prefer Upper Body template over Lower Body when recovery is equal.
g) Commit to ONE recommended template with clear reasoning (recovery gap, neglect risk, goal relevance).

--- STEP 2: ASK ONE SMART QUESTION ---

Before proposing any plan, ask exactly ONE personalized question. Make it specific and contextual:
- If the recommended session follows a hard session within the last 3 days → ask about soreness in the relevant muscle group. Example: "Last time you hit chest 2 days ago — any tightness today?"
- If the recommended session targets a group not trained in a long time → ask about readiness or available time. Example: "Shoulders and arms haven't been hit in 10 days — how much time do you have today and how's your energy?"
- If it's the client's first session ever → ask about available time and energy level.

Do NOT ask multiple questions. Do NOT propose the plan yet. Wait for the client's answer.

--- STEP 3: SEARCH AND PROPOSE THE PLAN ---

After the client responds:
1. Use search_exercises to find suitable exercises for the session (by muscle group, equipment).
   Apply equipment filter if context is clear (e.g. client trains at home → equipment="bodyweight").
   You may call search_exercises multiple times in a single turn for different muscle groups.
   Once you have results with IDs, do NOT re-search the same muscle group — reuse the IDs from this conversation history.
2. Propose the session with:
   - Brief reasoning — why this template today: gap since last done, recovery status, goal relevance.
   - The exercise list with IDs from search results, sets, reps, rest times.
   - A short closing invite: "Want to swap anything or shall we go?"

--- STEP 4: REFINE ---

Adjust the plan if the client requests changes (different exercises, shorter duration, skip something).
Use search_exercises ONLY if you need exercises not yet found in this conversation. Always keep exact exercise UUIDs.

--- STEP 5: START or CANCEL ---

- When the client explicitly approves the final plan → call \`start_training_session\` with the complete plan. Never call it before confirmation.
- start_training_session opens TODAY's session — call it only when the user is training now or about to start; sets the user reports from a PAST day ("вчера делал 110×12") are history, so acknowledge them but never start a session for them and never log them into today's session.
- If the client decides not to train today → call \`request_transition({ toPhase: 'chat' })\`.

If no active plan exists → tell the client they need a workout plan first and call \`request_transition({ toPhase: 'chat' })\`.`;

const TOOLS_TEXT = `=== TOOLS ===

- search_exercises: search exercise catalog by meaning. Call when you need exercises not yet in conversation history.
  Examples: query="chest compound barbell", muscleGroup="chest", equipment="barbell".
  Returns exercises with IDs — IDs are valid for the entire conversation, no need to re-fetch.
- start_training_session: call ONLY when user explicitly approves the final plan. Do NOT re-search before calling.
- request_transition: call with toPhase="chat" ONLY when user explicitly cancels.

CRITICAL: NEVER write JSON in your message text. NEVER output raw JSON blocks, action objects, or structured data in the message. ALL actions MUST be performed through tool calls only. Your message text must be plain conversational language only.
ANTI-PATTERN example — Bad: "{ action: 'start_training_session', args: { ... } }". Good: call the start_training_session tool directly. JSON in message text is a critical bug.

--- OFF-TOPIC GUARD ---

If the user's message is NOT about session planning (choosing a workout, exercises, sets, reps, weights, scheduling, recovery, or starting/cancelling a session):
1. Ask ONE short contextual question to clarify whether they want to stop planning.
   Keep it natural and tied to the current context. Examples:
   - "good night" → "Спокойной ночи! Тренировку на сегодня откладываем?"
   - non-fitness question → "Понял! Планирование сессии ставим на паузу?"
   - "thanks, bye" → "Удачи! Сессию оставляем на потом?"
2. If the user confirms leaving OR their next message is still not about session planning → call \`request_transition({ toPhase: 'chat', reason: 'off_topic' })\`.
3. If the user says they want to continue planning → stay and proceed normally.`;

export const SESSION_PLANNING_V3: PromptModule<SessionPlanningPromptContextV3> = {
  id: 'phase.session_planning',
  version: 'v3',
  directives: DEFAULT_DIRECTIVES_V2,
  render(ctx: SessionPlanningPromptContextV3): Section[] {
    const { context } = ctx;

    const daysSince =
      context.daysSinceLastWorkout !== null
        ? `${context.daysSinceLastWorkout} days since last workout`
        : 'No previous workouts';

    return [
      { id: 'date', required: true, text: daysSince },
      { id: 'task', required: true, text: TASK_TEXT },
      { id: 'tools', required: true, text: TOOLS_TEXT },
      ...renderDirectives(this.directives, ctx),
    ];
  },
};
