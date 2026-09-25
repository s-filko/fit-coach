/**
 * set_language (BUG-036 + owner language rule, R3, session-investigation-0925
 * plan). `users.language_code` is the ONLY source of the user's language:
 * Telegram seeds it once at user creation, this tool is the only thing that
 * may change it afterwards. Shared across every phase — a language switch
 * can come up anywhere, like save_timezone. It writes the profile ONLY when
 * the user explicitly asks to switch language; the model must never call it
 * just because the user happens to write in a different language than the
 * profile currently has (owner rule: language must never change behaviour —
 * only the language of fixed texts).
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { ok, userError } from '@domain/conversation/tool-outcome';
import type { IUserService } from '@domain/user/ports';

import { userIdOf } from './format-exercise-summary';

export interface SetLanguageToolDeps {
  userService: IUserService;
}

export function buildSetLanguageTool(deps: SetLanguageToolDeps) {
  const { userService } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config);
      if (!userId) {
        return userError('Error: could not identify user. Please try again.');
      }

      await userService.updateProfileData(userId, { languageCode: input.language });
      return ok(`Language switched to ${input.language}.`);
    },
    {
      name: 'set_language',
      description:
        "Switch the user's language. Call this ONLY when the user EXPLICITLY asks to change the language you " +
        'reply in (e.g. "ответь мне по-русски", "switch to English", "speak English with me from now on"). ' +
        'Never call it just because the user wrote this particular message in a different language — that must ' +
        'never change anything; the reply language always follows the profile, not the message.',
      schema: z.object({
        language: z.enum(['ru', 'en']).describe('The language to switch the profile to.'),
      }),
    },
  );
}
