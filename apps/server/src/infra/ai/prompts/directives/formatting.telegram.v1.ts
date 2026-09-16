import type { DirectiveModule } from '@infra/ai/prompts/types';

export const FORMATTING_TELEGRAM_V1: DirectiveModule = {
  id: 'formatting.telegram',
  version: 'v1',
  render: () => ({
    id: 'directive.formatting.telegram',
    required: true,
    text: [
      '=== FORMATTING ===',
      '',
      'Use Telegram HTML for all responses: <b>bold</b> for key data, <i>italic</i> for tips or secondary info.',
      'Do NOT use Markdown asterisks (**bold**), underscores (_italic_), or any other Markdown syntax.',
    ].join('\n'),
  }),
};
