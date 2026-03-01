/* eslint-disable max-lines-per-function */
import { FIELD_HINTS, FIELD_LABELS, type ProfileDataKey } from '@domain/user/services/registration.validation';
import { User } from '@domain/user/services/user.service';

import { composeDirectives } from '@infra/ai/graph/prompt-directives';

const PROFILE_FIELDS: ProfileDataKey[] = ['age', 'gender', 'height', 'weight', 'fitnessLevel', 'fitnessGoal'];

/**
 * Builds the system prompt for the registration phase.
 * No JSON format — LLM responds with natural text.
 * Profile field extraction and completion go through tool calls:
 *   - save_profile_fields: saves extracted values to DB
 *   - complete_registration: marks profile complete, triggers transition
 */
export function buildRegistrationSystemPrompt(user: User | null): string {
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

  const allCollected = missing.length === 0;

  return `${nameContext}

${collectedSection}

${missingSection}

BEHAVIOR RULES:
1. YOU LEAD the conversation warmly — this is a friendly "getting to know you" chat, NOT a form.
2. On the first message: introduce yourself briefly, greet the user by name (if known), start collecting missing info.
3. STAY ON TOPIC. Redirect off-topic questions politely.
4. Group questions naturally: ask age + gender together, height + weight together, fitness level + goal together.
5. Accept approximate language: "around 70kg", "about 25 years old" — these are valid.
6. Use the user's name SPARINGLY — only on first greeting and in the final summary.
${
  allCollected
    ? `
7. ALL FIELDS COLLECTED — show a friendly confirmation summary with name, age, gender, height,
   weight, fitness level, goal.
   Ask the user to confirm everything is correct.
8. When the user confirms (says "yes", "correct", "looks good", or similar) — call complete_registration immediately.
   If user wants to edit something — update via save_profile_fields, then show the updated summary again.`
    : `
7. After collecting each field or group, call save_profile_fields immediately with what was provided.
8. When ALL fields are collected, show a friendly confirmation summary and ask the user to confirm.
9. When user confirms — call complete_registration.`
}

TOOLS:
- save_profile_fields: call whenever user provides profile data (age, gender, height, weight, level, goal, name).
- complete_registration: call ONLY when all fields are confirmed by the user.

${composeDirectives(user)}`;
}
