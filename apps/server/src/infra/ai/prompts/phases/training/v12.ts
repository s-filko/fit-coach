import type { Section } from '@infra/ai/prompts/types';

import { TRAINING_V11, type TrainingPromptContextV11 } from './v11';

/**
 * v12 (load-plan-fixes item 3, AC-LPF-3, BR-LLM-008): v11 with the conservative-option wording made conditional.
 * LOAD PLAN may now say `no number` / `no conservative option` (no record AND no reference load); v11 demanded
 * "always show the conservative option", which the block could not satisfy — the coach invented one (replay U2: the
 * same load twice, presented as "conservative"). v12 says: show it when the block gives one; when it gives none,
 * say so and do not invent one. Only rule 1 (two lines) and rule 4b change; every other line is v11's, byte for byte.
 * Selected with LOAD_PLAN_PLANNER_REBIND on (training.spec.ts); v11 stays registered and unchanged.
 */
export type TrainingPromptContextV12 = TrainingPromptContextV11;

/** [v11 text, v12 text] — a missing v11 text is a loud failure, never a silent no-op. */
const REPLACEMENTS: [string, string][] = [
  [
    'Always show the `conservative:` option as the alternative. When LOAD PLAN says insufficient data (no completed record), say so plainly and suggest a conservative start; never borrow kilograms from a different exercise.',
    'Show the `conservative:` option as the alternative whenever the block gives one. When the block says `no number` / `no conservative option` (no record and no reference load), say so plainly: name no load as a LOAD PLAN suggestion and do not invent one, and do not invent a conservative option either — ask the client what they usually use or start light by feel; never borrow kilograms from a different exercise. When insufficient data still carries a number (it names the reference performance), that number is the suggestion, at low confidence.',
  ],
  ['together with the conservative option.', 'together with the conservative option when the block gives one.'],
  [
    'with the LOAD PLAN suggestion: `recommend:` with the `conservative:` option, adjusted',
    'with the LOAD PLAN suggestion: `recommend:` with the `conservative:` option when the block gives one, adjusted',
  ],
];

function rebind(task: string): string {
  return REPLACEMENTS.reduce((text, [from, to]) => {
    if (!text.includes(from)) {
      throw new Error(`training v12: expected v11 text not found: ${from.slice(0, 60)}`);
    }
    return text.replace(from, to);
  }, task);
}

export const TRAINING_V12 = {
  ...TRAINING_V11,
  version: 'v12',
  render(ctx: TrainingPromptContextV12): Section[] {
    return TRAINING_V11.render(ctx).map(s => (s.id === 'task' ? { ...s, text: rebind(s.text) } : s));
  },
};
