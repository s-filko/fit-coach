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

/**
 * Transitional (ADR-0013 §11, D-D): how a phase's agentNode lays out the
 * message array around the rendered phase prompt. Owner rule (STATE.md,
 * 2026-09-17): one chat across the app — phases differ only by prompt, tools
 * and context loaders. Every flag below is a deviation from that rule with a
 * scheduled removal: `historyMode`, `summaryFrame` and `toolResultsFrame` →
 * P4 (the messages channel, episode summaries). The post-tool nudge and the
 * run merge left with P3's shared agent node.
 */
export interface PhaseLayout {
  /** Whether the phase injects the previous-summary frame (registration: false, others: true). */
  summaryFrame: boolean;
  /** training frames history as one system block; the other phases interleave the turns. */
  historyMode: 'interleaved' | 'history_frame';
  /** training only: the tool-results system block after the in-flight messages. */
  toolResultsFrame: boolean;
}

export interface PhaseRegistryEntry {
  entry: PhasePromptEntry<unknown>;
  layout: PhaseLayout;
}

/** The one list. L0 renders it; persist stamps from it; nothing outside it reaches the model. */
export const PHASE_PROMPTS: Record<ConversationPhase, PhaseRegistryEntry> = {
  registration: {
    entry: REGISTRATION_PROMPT as PhasePromptEntry<unknown>,
    layout: {
      summaryFrame: false,
      historyMode: 'interleaved',
      toolResultsFrame: false,
    },
  },
  chat: {
    entry: CHAT_PROMPT as PhasePromptEntry<unknown>,
    layout: {
      summaryFrame: true,
      historyMode: 'interleaved',
      toolResultsFrame: false,
    },
  },
  plan_creation: {
    entry: PLAN_CREATION_PROMPT as PhasePromptEntry<unknown>,
    layout: {
      summaryFrame: true,
      historyMode: 'interleaved',
      toolResultsFrame: false,
    },
  },
  session_planning: {
    entry: SESSION_PLANNING_PROMPT as PhasePromptEntry<unknown>,
    layout: {
      summaryFrame: true,
      historyMode: 'interleaved',
      toolResultsFrame: false,
    },
  },
  training: {
    entry: TRAINING_PROMPT as PhasePromptEntry<unknown>,
    layout: {
      summaryFrame: true,
      historyMode: 'history_frame',
      toolResultsFrame: true,
    },
  },
};

export const STANDALONE_PROMPTS: readonly PromptModule<unknown>[] = [
  SUMMARIZER_PROMPT as PromptModule<unknown>,
  SUMMARY_FRAME_V1 as PromptModule<unknown>,
  HISTORY_FRAME_V1 as PromptModule<unknown>,
  TOOL_RESULTS_V1 as PromptModule<unknown>,
  POST_TOOL_NUDGE_V1 as PromptModule<unknown>,
];

/**
 * The block modules a phase's layout injects, in the assembler's fixed order,
 * plus the post-tool nudge for every phase (refactor-p3-phase-spec Task 1:
 * ADR-0013 §6 applies the nudge to all phases, so its version is stamped on
 * every run). Drives `promptVersionsForPhase`; Task 5's wiring stops handing
 * it to subgraphs.
 */
export function blocksForLayout(layout: PhaseLayout): readonly PromptModule<unknown>[] {
  const blocks: PromptModule<unknown>[] = [];
  if (layout.summaryFrame) {
    blocks.push(SUMMARY_FRAME_V1 as PromptModule<unknown>);
  }
  if (layout.historyMode === 'history_frame') {
    blocks.push(HISTORY_FRAME_V1 as PromptModule<unknown>);
  }
  if (layout.toolResultsFrame) {
    blocks.push(TOOL_RESULTS_V1 as PromptModule<unknown>);
  }
  blocks.push(POST_TOOL_NUDGE_V1 as PromptModule<unknown>);
  return blocks;
}

export function promptVersionsForPhase(phase: ConversationPhase): Record<string, string> {
  const { entry } = PHASE_PROMPTS[phase];
  const versions = promptVersionsOf(entry.current);
  for (const block of blocksForLayout(PHASE_PROMPTS[phase].layout)) {
    versions[block.id] = block.version;
  }
  return versions;
}
