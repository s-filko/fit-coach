/**
 * The composition root for the phase specs (ADR-0013 §4.2): tools and loaders
 * need repositories, so the specs are built with deps. After building, the
 * spec objects are plain data. INV-LLM-005: adding a phase means adding a
 * spec here — the graph builder is not edited.
 */
import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';

import { buildChatSpec } from './chat.spec';
import { buildPlanCreationSpec } from './plan-creation.spec';
import { buildRegistrationSpec } from './registration.spec';
import { buildSessionPlanningSpec } from './session-planning.spec';
import { buildTrainingSpec } from './training.spec';

/** The five phases, in ConversationPhase order. */
export function buildPhaseSpecs(deps: ConversationGraphDeps): PhaseSpec[] {
  return [
    buildRegistrationSpec(deps),
    buildChatSpec(deps),
    buildPlanCreationSpec(deps),
    buildSessionPlanningSpec(deps),
    buildTrainingSpec(deps),
  ];
}

export { buildRegistrationSpec, REGISTRATION_TOOL_POLICY, type RegistrationData } from './registration.spec';
export { buildChatSpec, CHAT_TOOL_POLICY, type ChatData } from './chat.spec';
export { buildPlanCreationSpec, PLAN_CREATION_TOOL_POLICY, type PlanCreationData } from './plan-creation.spec';
export {
  buildSessionPlanningSpec,
  SESSION_PLANNING_TOOL_POLICY,
  type SessionPlanningData,
} from './session-planning.spec';
export { buildTrainingSpec, buildTrainingToolPolicy, type TrainingData } from './training.spec';
