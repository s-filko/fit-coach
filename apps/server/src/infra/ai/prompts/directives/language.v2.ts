import type { DirectiveModule } from '@infra/ai/prompts/types';

/**
 * BUG-036 + owner language rule (R3, session-investigation-0925 plan,
 * verbatim 2026-09-25): «начальное значение мы можем взять из телеграмма, но
 * потом когда пользователь поменял язык он должен оставаться в системе не
 * связанным с телеграммом» — `users.language_code` (the profile, seeded once
 * from Telegram at creation, `set_language` tool thereafter) is the ONLY
 * source, never Telegram directly. V1's "(from Telegram)" wording implied the
 * opposite and is dropped here; V1 itself stays untouched (frozen v1
 * snapshots, AC-1321). Wired into `DEFAULT_DIRECTIVES_V2` /
 * `DIRECTIVES_WITHOUT_IDENTITY_V2` in `./index.ts`, replacing `LANGUAGE_V1`.
 */
export const LANGUAGE_V2: DirectiveModule = {
  id: 'language',
  version: 'v2',
  render: ({ user }) => ({
    id: 'directive.language',
    required: true,
    text: user?.languageCode
      ? `USER LANGUAGE: '${user.languageCode}'. Always respond in this language.`
      : 'Respond in the same language the user writes in.',
  }),
};
