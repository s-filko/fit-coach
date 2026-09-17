import type { ToolMessage } from '@langchain/core/messages';

import { LLM_ERROR_PREFIX, SYSTEM_ERROR_PREFIX } from '@infra/ai/graph/tools/training.tools';
import { renderBlock, TOOL_RESULTS_V1 } from '@infra/ai/prompts/blocks';

/**
 * Renders the tool-results system block so the LLM has a factual, structured
 * source to cite in its reply — preventing hallucinated "I logged..."
 * confirmations when no tool was actually called (BUG-006/BUG-009).
 *
 * Moved verbatim from training.subgraph.ts (refactor-p2-context-assembler
 * Task 4 / D-E): the block is a position in the assembled message array, so
 * it belongs to the context assembler. It keeps importing the error prefixes
 * from the training tools until P3's ToolOutcome removes that import.
 */
export function renderToolResults(toolMessages: ToolMessage[]): string {
  const results = toolMessages.map(m => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const isError =
      m.status === 'error' || content.startsWith(LLM_ERROR_PREFIX) || content.startsWith(SYSTEM_ERROR_PREFIX);
    return isError
      ? { ok: false as const, content: content.replace(LLM_ERROR_PREFIX, '').replace(SYSTEM_ERROR_PREFIX, '').trim() }
      : { ok: true as const, content };
  });

  return renderBlock(TOOL_RESULTS_V1, { results });
}
