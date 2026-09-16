import type { ConversationPhase } from '@domain/conversation/ports';

import { HISTORY_FRAME_V1, POST_TOOL_NUDGE_V1, SUMMARY_FRAME_V1, TOOL_RESULTS_V1 } from './blocks';
import { promptVersionsOf } from './compose';
import { CHAT_PROMPT } from './phases/chat';
import { PLAN_CREATION_PROMPT } from './phases/plan_creation';
import { REGISTRATION_PROMPT } from './phases/registration';
import { SESSION_PLANNING_PROMPT } from './phases/session_planning';
import { TRAINING_PROMPT } from './phases/training';
import { SUMMARIZER_PROMPT } from './summarizer';
import type { PhasePromptEntry, PromptModule } from './types';

export interface PhaseRegistryEntry {
  entry: PhasePromptEntry<unknown>;
  /** Blocks the phase's agentNode injects — from today's message assembly, per subgraph. */
  blocks: readonly PromptModule<unknown>[];
}

/** The one list. L0 renders it; persist stamps from it; nothing outside it reaches the model. */
export const PHASE_PROMPTS: Record<ConversationPhase, PhaseRegistryEntry> = {
  registration: { entry: REGISTRATION_PROMPT as PhasePromptEntry<unknown>, blocks: [] },
  chat: { entry: CHAT_PROMPT as PhasePromptEntry<unknown>, blocks: [SUMMARY_FRAME_V1] },
  plan_creation: {
    entry: PLAN_CREATION_PROMPT as PhasePromptEntry<unknown>,
    blocks: [SUMMARY_FRAME_V1, POST_TOOL_NUDGE_V1],
  },
  session_planning: {
    entry: SESSION_PLANNING_PROMPT as PhasePromptEntry<unknown>,
    blocks: [SUMMARY_FRAME_V1, POST_TOOL_NUDGE_V1],
  },
  training: {
    entry: TRAINING_PROMPT as PhasePromptEntry<unknown>,
    blocks: [SUMMARY_FRAME_V1, HISTORY_FRAME_V1, TOOL_RESULTS_V1, POST_TOOL_NUDGE_V1],
  },
};

export const STANDALONE_PROMPTS: readonly PromptModule<unknown>[] = [
  SUMMARIZER_PROMPT as PromptModule<unknown>,
  SUMMARY_FRAME_V1 as PromptModule<unknown>,
  HISTORY_FRAME_V1 as PromptModule<unknown>,
  TOOL_RESULTS_V1 as PromptModule<unknown>,
  POST_TOOL_NUDGE_V1 as PromptModule<unknown>,
];

export function promptVersionsForPhase(phase: ConversationPhase): Record<string, string> {
  const { entry, blocks } = PHASE_PROMPTS[phase];
  const versions = promptVersionsOf(entry.current);
  for (const block of blocks) {
    versions[block.id] = block.version;
  }
  return versions;
}
