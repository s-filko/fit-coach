import type { DirectiveModule } from '@infra/ai/prompts/types';

export const OUTPUT_V1: DirectiveModule = {
  id: 'output',
  version: 'v1',
  render: () => ({
    id: 'directive.output',
    required: true,
    text: 'Respond with natural text only. Do NOT include JSON in your response.',
  }),
};
