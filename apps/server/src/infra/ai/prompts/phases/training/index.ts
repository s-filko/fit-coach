import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { TRAINING_V1, type TrainingPromptContext } from './v1';
import { TRAINING_V10, type TrainingPromptContextV10 } from './v10';
import { TRAINING_V2, type TrainingPromptContextV2 } from './v2';
import { TRAINING_V3, type TrainingPromptContextV3 } from './v3';
import { TRAINING_V4, type TrainingPromptContextV4 } from './v4';
import { TRAINING_V5, type TrainingPromptContextV5 } from './v5';
import { TRAINING_V6, type TrainingPromptContextV6 } from './v6';
import { TRAINING_V7, type TrainingPromptContextV7 } from './v7';
import { TRAINING_V8, type TrainingPromptContextV8 } from './v8';
import { TRAINING_V9, type TrainingPromptContextV9 } from './v9';

export type {
  TrainingPromptContext,
  TrainingPromptContextV2,
  TrainingPromptContextV3,
  TrainingPromptContextV4,
  TrainingPromptContextV5,
  TrainingPromptContextV6,
  TrainingPromptContextV7,
  TrainingPromptContextV8,
  TrainingPromptContextV9,
  TrainingPromptContextV10,
};
export {
  TRAINING_V1,
  TRAINING_V2,
  TRAINING_V3,
  TRAINING_V4,
  TRAINING_V5,
  TRAINING_V6,
  TRAINING_V7,
  TRAINING_V8,
  TRAINING_V9,
  TRAINING_V10,
};

/**
 * Section contract — a future version must still emit these ids (L0
 * required-sections check). `client` and `workout_overview` moved to
 * `training.*` domain blocks in v2 (P4 context-budget plan, Task 2, D-B) —
 * neither is a prompt section any more; `task`/`rules` are always emitted.
 */
export const TRAINING_PROMPT: PhasePromptEntry<TrainingPromptContextV10> = {
  current: TRAINING_V10,
  requiredSections: ['task', 'tools', 'rules', 'directive.tool-reply'],
};
