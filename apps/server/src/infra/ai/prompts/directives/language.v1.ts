import type { DirectiveModule } from '@infra/ai/prompts/types';

export const LANGUAGE_V1: DirectiveModule = {
  id: 'language',
  version: 'v1',
  render: ({ user }) => ({
    id: 'directive.language',
    required: true,
    text: user?.languageCode
      ? `USER LANGUAGE (from Telegram): '${user.languageCode}'. Always respond in this language.`
      : 'Respond in the same language the user writes in.',
  }),
};
