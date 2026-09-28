import type { ConversationPhase } from '@domain/conversation/ports';

import { CURRENT_TIME_V1, EPISODE_SUMMARIES_V2, POST_TOOL_NUDGE_V1 } from './blocks';
import { promptVersionsOf } from './compose';
import { FACT_VERIFIER_V1 } from './fact-verifier';
import { CHAT_PROMPT } from './phases/chat';
import { PLAN_CREATION_PROMPT } from './phases/plan_creation';
import { REGISTRATION_PROMPT } from './phases/registration';
import { SESSION_PLANNING_PROMPT } from './phases/session_planning';
import { TRAINING_PROMPT } from './phases/training';
import { SUMMARIZER_PROMPT } from './summarizer';
import type { PhasePromptEntry, PromptModule } from './types';

/**
 * One message shape for every phase (owner rule 2026-09-17; ADR-0013 §3.4):
 * phases differ only by prompt, tools and context loaders — the per-phase
 * `PhaseLayout` (`history_frame`, `summaryFrame`, `toolResultsFrame`) is gone;
 * history interleaves from the `messages` channel and summaries render as the
 * `## Previous episodes` block for every phase alike.
 */
export const PHASE_PROMPTS: Record<ConversationPhase, PhasePromptEntry<unknown>> = {
  registration: REGISTRATION_PROMPT as PhasePromptEntry<unknown>,
  chat: CHAT_PROMPT as PhasePromptEntry<unknown>,
  plan_creation: PLAN_CREATION_PROMPT as PhasePromptEntry<unknown>,
  session_planning: SESSION_PLANNING_PROMPT as PhasePromptEntry<unknown>,
  training: TRAINING_PROMPT as PhasePromptEntry<unknown>,
};

export const STANDALONE_PROMPTS: readonly PromptModule<unknown>[] = [
  SUMMARIZER_PROMPT as PromptModule<unknown>,
  FACT_VERIFIER_V1 as PromptModule<unknown>,
  EPISODE_SUMMARIES_V2 as PromptModule<unknown>,
  POST_TOOL_NUDGE_V1 as PromptModule<unknown>,
];

/**
 * Every block a phase's run stamps, for every phase alike: the phase module,
 * the NOW line (its own message before `current` since now-line-last — sent
 * on every call, so stamped on every run; review R1), the episode-summaries
 * block (rendered only when summaries exist), and the post-tool nudge
 * (ADR-0013 §6 applies it to all phases). The conditionally sent time-gap
 * note is NOT here — the agent node records it on the run context when it
 * actually renders one, and `commit` merges it in.
 */
export function promptVersionsForPhase(phase: ConversationPhase): Record<string, string> {
  const versions = promptVersionsOf(PHASE_PROMPTS[phase].current);
  versions[CURRENT_TIME_V1.id] = CURRENT_TIME_V1.version;
  versions[EPISODE_SUMMARIES_V2.id] = EPISODE_SUMMARIES_V2.version;
  versions[POST_TOOL_NUDGE_V1.id] = POST_TOOL_NUDGE_V1.version;
  return versions;
}
