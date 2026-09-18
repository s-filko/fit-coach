import type { PromptModule, Section } from '@infra/ai/prompts/types';

/** Row 11 — invoke-with-retry's nudge. */
export const POST_TOOL_NUDGE_V1: PromptModule<Record<string, never>> = {
  id: 'block.post_tool_nudge',
  version: 'v1',
  directives: [],
  render(): Section[] {
    return [
      {
        id: 'post_tool_nudge',
        required: true,
        text: 'IMPORTANT: All tool calls are complete. You MUST now write a natural text response to the user. Do NOT call any more tools.',
      },
    ];
  },
};
