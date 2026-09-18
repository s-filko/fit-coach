/**
 * Registration PhaseSpec (ADR-0013 §4.2) — moved verbatim from
 * registration.subgraph.ts (refactor-p3-phase-spec Task 1).
 */
import type {
  ConversationGraphDeps,
  LoadInput,
  PhasePromptEntry,
  PhaseSpec,
  PromptContextFor,
} from '@infra/ai/graph/phase-spec';
import { PHASE_PROMPTS } from '@infra/ai/prompts';
import { buildCompleteRegistrationTool, buildSaveProfileFieldsTool, buildSharedTools } from '@infra/ai/tools';

import { NO_POLICY, type ToolPolicy } from '../tool-policy';

/** What the registration prompt renders beyond the directive base: nothing. */
export type RegistrationData = object;

export const REGISTRATION_TOOL_POLICY: ToolPolicy = NO_POLICY;

export function buildRegistrationSpec(deps: ConversationGraphDeps): PhaseSpec<RegistrationData> {
  const { userService } = deps;
  const entry = PHASE_PROMPTS.registration;

  return {
    name: 'registration',
    prompt: entry as PhasePromptEntry<PromptContextFor<RegistrationData>>,
    tools: [
      buildSaveProfileFieldsTool({ userService }),
      buildCompleteRegistrationTool({ userService }),
      ...buildSharedTools({ userService }),
    ],
    toolPolicy: REGISTRATION_TOOL_POLICY,
    // ADR-0013 §3.4 table values (D-D — data; P4 reads only `history`).
    budget: { system: 2500, longTerm: 1000, domain: 1000, history: 6000, outputReserve: 1500 },
    loadContext: async (_input: LoadInput, _deps: ConversationGraphDeps) => ({
      ok: true as const,
      data: {},
    }),
    // D-B: no domain sections moved out of the registration prompt (it has none).
    contextBlocks: [],
    modelProfile: 'default',
  };
}
