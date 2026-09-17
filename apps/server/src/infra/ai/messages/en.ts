import type { MessageKey } from './catalog';

/**
 * English catalog entries — translations of the ru originals (2026-09),
 * owner-reviewed in the refactor-p3-tool-executor PR (decision D-F).
 */
export const en: Record<MessageKey, string> = {
  // translation of the ru original (2026-09)
  tool_error_budget_exhausted:
    "Couldn't save the data after several attempts. Please rephrase: state the exercise, weight and number of reps clearly.",
  // translation of the ru original (2026-09)
  tool_system_error: 'A technical error occurred while saving your training data. Please try again or contact support.',
  // today's training.subgraph.ts guard literals, verbatim (refactor-p3-phase-spec Task 1, D-B)
  training_no_active_session: 'No active training session found. Please start a session first.',
  training_session_not_found: 'Training session not found. It may have already been completed.',
};
