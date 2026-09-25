import { FIELD_HINTS, FIELD_LABELS, type ProfileDataKey } from '@domain/user/services/registration.validation';
import type { User } from '@domain/user/services/user.service';

import { renderDirectives } from '@infra/ai/prompts/compose';
import { DEFAULT_DIRECTIVES_V2 } from '@infra/ai/prompts/directives';
import type { DirectiveContext, PromptModule, Section } from '@infra/ai/prompts/types';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- v2 adds no fields
export interface RegistrationPromptContextV2 extends DirectiveContext {}

const PROFILE_FIELDS: ProfileDataKey[] = ['age', 'gender', 'height', 'weight', 'fitnessLevel', 'fitnessGoal'];

interface ProfileRows {
  collected: string[];
  missing: string[];
}

function collectProfileRows(user: User | null): ProfileRows {
  const collected: string[] = [];
  const missing: string[] = [];

  for (const key of PROFILE_FIELDS) {
    const value = user?.[key as keyof User];
    const label = FIELD_LABELS[key];
    const hint = FIELD_HINTS[key];

    if (value !== undefined && value !== null && value !== '') {
      collected.push(`  - ${label}: ${value}`);
    } else {
      missing.push(`  - ${label} (${hint})`);
    }
  }

  return { collected, missing };
}

/**
 * v2 (transition-handoff plan Task 7, BUG-032): identical to v1 except the
 * directive list — `DEFAULT_DIRECTIVES_V2` appends `CURRENT_TIME_V1`, giving
 * this phase a "now" line for the first time. No section wording changes.
 */
export const REGISTRATION_V2: PromptModule<RegistrationPromptContextV2> = {
  id: 'phase.registration',
  version: 'v2',
  directives: DEFAULT_DIRECTIVES_V2,
  render(ctx: RegistrationPromptContextV2): Section[] {
    const { user } = ctx;
    const { collected, missing } = collectProfileRows(user);

    const telegramName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || null;

    if (telegramName) {
      collected.unshift(`  - name: ${telegramName}`);
    } else if (!user?.firstName) {
      missing.unshift('  - name (what to call you)');
    }

    const collectedSection =
      collected.length > 0 ? `ALREADY COLLECTED:\n${collected.join('\n')}` : 'ALREADY COLLECTED: nothing yet';

    const missingSection =
      missing.length > 0
        ? `STILL MISSING:\n${missing.join('\n')}`
        : 'STILL MISSING: nothing — all fields collected! Show summary and ask for confirmation.';

    const nameContext = telegramName
      ? `USER NAME (from Telegram): '${telegramName}'. Greet them by name. Include it in the final summary.`
      : 'USER NAME: not provided. Ask for their name early in the conversation.';

    const behaviorRules = `BEHAVIOR RULES:
1. YOU LEAD the conversation warmly — this is a friendly "getting to know you" chat, NOT a form.
2. On the first message: introduce yourself briefly, greet the user by name (if known), start collecting missing info.
3. STAY ON TOPIC. Redirect off-topic questions politely.
4. Group questions naturally: ask age + gender together, height + weight together, fitness level + goal together.
5. Accept approximate language: "around 70kg", "about 25 years old" — these are valid.
${
  missing.length === 0
    ? `
6. ALL FIELDS COLLECTED — show a friendly confirmation summary with name, age, gender, height,
   weight, fitness level, goal.
   Ask the user to confirm everything is correct.
7. When the user confirms (says "yes", "correct", "looks good", or similar) — call complete_registration immediately.
   If user wants to edit something — update via save_profile_fields, then show the updated summary again.`
    : `
6. After collecting each field or group, call save_profile_fields immediately with what was provided.
7. When ALL fields are collected, show a friendly confirmation summary and ask the user to confirm.
8. When user confirms — call complete_registration.`
}`;

    const toolsText = `TOOLS:
- save_profile_fields: call whenever user provides profile data (age, gender, height, weight, level, goal, name).
- complete_registration: call ONLY when all fields are confirmed by the user.`;

    return [
      { id: 'name_context', required: true, text: nameContext },
      { id: 'collected', required: true, text: collectedSection },
      { id: 'missing', required: true, text: missingSection },
      { id: 'behavior_rules', required: true, text: behaviorRules },
      { id: 'tools', required: true, text: toolsText },
      ...renderDirectives(this.directives, ctx),
    ];
  },
};
