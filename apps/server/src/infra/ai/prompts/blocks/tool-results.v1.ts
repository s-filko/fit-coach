import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface ToolResultsContext {
  results: Array<{ ok: boolean; content: string }>;
}

/** Row 8 of the P2 inventory — the BUG-006/BUG-009 "report only what tools confirmed" block. */
export const TOOL_RESULTS_V1: PromptModule<ToolResultsContext> = {
  id: 'block.tool_results',
  version: 'v1',
  directives: [],
  render({ results }): Section[] {
    const lines = results.map(r => (r.ok ? `• ✅ SAVED — ${r.content}` : `• ❌ NOT SAVED — ${r.content}`));
    return [
      {
        id: 'tool_results',
        required: true,
        text: [
          '=== TOOL EXECUTION RESULTS ===',
          ...lines,
          '',
          'Your response MUST start by reporting each result above to the user.',
          'For each ✅ SAVED line: tell the user the set was recorded with exact numbers.',
          'For each ❌ NOT SAVED line: tell the user the set was NOT recorded and ask them to retry.',
          'Do NOT invent or assume any result not listed here.',
        ].join('\n'),
      },
    ];
  },
};
