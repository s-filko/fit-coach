import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { TRAINING_V1, type TrainingPromptContext } from './v1';
import { TRAINING_V2, type TrainingPromptContextV2 } from './v2';
import { TRAINING_V3, type TrainingPromptContextV3 } from './v3';

export type { TrainingPromptContext, TrainingPromptContextV2, TrainingPromptContextV3 };
export { TRAINING_V1, TRAINING_V2, TRAINING_V3 };

/**
 * Section contract — a future version must still emit these ids (L0
 * required-sections check). `client` and `workout_overview` moved to
 * `training.*` domain blocks in v2 (P4 context-budget plan, Task 2, D-B) —
 * neither is a prompt section any more; `task`/`rules` are always emitted.
 */
export const TRAINING_PROMPT: PhasePromptEntry<TrainingPromptContextV3> = {
  current: TRAINING_V3,
  requiredSections: ['task', 'tools', 'rules', 'directive.tool-reply'],
};
