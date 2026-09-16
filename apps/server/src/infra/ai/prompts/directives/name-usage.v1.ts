import type { DirectiveModule } from '@infra/ai/prompts/types';

export const NAME_USAGE_V1: DirectiveModule = {
  id: 'name-usage',
  version: 'v1',
  render: () => ({
    id: 'directive.name-usage',
    required: true,
    text: "Use the client's name SPARINGLY — only on first greeting and in summary/recap messages. Do NOT repeat the name in every response.",
  }),
};
