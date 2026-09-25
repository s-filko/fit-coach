import { renderDirectives } from '@infra/ai/prompts/compose';
import { DEFAULT_DIRECTIVES_V2 } from '@infra/ai/prompts/directives';
import type { DirectiveContext, PromptModule, Section } from '@infra/ai/prompts/types';

/**
 * v3 (transition-handoff plan Task 7, BUG-032): identical to v2 except the
 * directive list — `DEFAULT_DIRECTIVES_V2` appends `CURRENT_TIME_V1`. chat
 * rendered no current date or time at all before this; every other section
 * renders the exact wording v2 rendered for it.
 */
export interface ChatPromptContextV3 extends DirectiveContext {
  hasActivePlan: boolean;
}

const RULES_TEXT = `RULES:
1. SCOPE: Only discuss fitness, training, nutrition, health, wellness. Redirect anything else.
2. PERSONALIZATION: Consider the client profile when giving advice.
3. STYLE: Brief, motivating, conversational. Minimal emoji.
4. PROACTIVE: On "hi"/"hello" — greet and suggest something fitness-related.
5. WORKOUT PLAN: `;

const TOOLS_TEXT = `TOOLS (use when needed):
- update_profile: when user wants to change their name, age, gender, weight, height, fitness level, or goal.
- request_transition toPhase="plan_creation": when user explicitly wants to create a workout plan.
- request_transition toPhase="session_planning": when user wants to train today / start a session / plan a workout.
  ALWAYS use this tool — never describe workouts yourself from chat.
  ANTI-PATTERN: announcing a transition in text WITHOUT calling request_transition.
  Text alone does not trigger a transition — only the tool call does.
  Always call the tool; your text accompanies the call, not replaces it.`;

/** BUG-009 guard — the chat model must never claim it logged a set. */
const NO_SET_LOGGING_TEXT = `IMPORTANT: You do NOT have log_set or any set-logging capability. You CANNOT save workout sets.
NEVER write "✅", "logged", "saved", "recorded" about sets.
If the user reports a set, transition to training or tell them to start a session first.`;

export const CHAT_V3: PromptModule<ChatPromptContextV3> = {
  id: 'phase.chat',
  version: 'v3',
  directives: DEFAULT_DIRECTIVES_V2,
  render(ctx: ChatPromptContextV3): Section[] {
    const { hasActivePlan } = ctx;

    const planRule = hasActivePlan
      ? 'When the user wants to train/start a workout/plan today\'s session, IMMEDIATELY call request_transition({ toPhase: "session_planning" }). Do NOT give workout advice directly from chat.'
      : 'Suggest creating a workout plan if user wants to train. Call request_transition({ toPhase: "plan_creation" }) when user agrees.';

    return [
      { id: 'rules', required: true, text: `${RULES_TEXT}${planRule}` },
      { id: 'tools', required: true, text: TOOLS_TEXT },
      { id: 'no_set_logging', required: true, text: NO_SET_LOGGING_TEXT },
      ...renderDirectives(this.directives, ctx),
    ];
  },
};
