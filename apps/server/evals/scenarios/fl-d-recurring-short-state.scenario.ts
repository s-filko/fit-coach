import type { Scenario } from '../schema/scenario.schema';

import { pastWith } from './fl-shared';

/**
 * Journey FL-D — the same short state recurring three times (course-check
 * plan Task 3 / AC-FL-7).
 *
 * The user's shoulder aches after pressing; it passes; it comes back; it
 * passes; it comes back. Each RETURN is a genuinely new statement after a
 * closure, so it creates a NEW row linked to the closed one via
 * `supersedes_id`, and the closed rows keep their archive. Three occurrences
 * leave a three-row chain: two archived, one active.
 *
 * WHY IT STOPS THERE (owner decision, 2026-09-21 — worker ask): the owner's
 * model says a recurring short state is promoted to a `physiological_pattern`
 * fact, but NOTHING in the code performs that promotion yet — it is not part
 * of this plan, and who promotes / how identity is judged / the threshold are
 * product decisions still open. So this journey asserts the chain — the
 * evidence a promotion would count — and deliberately asserts NO pattern fact:
 * scripting the coach to write one would make the test author the ending
 * instead of the code. The gap is an `it.todo` in the test file.
 */

export const RECURRING_FACT = 'Left shoulder aches after pressing';

const save = {
  toolCall: {
    name: 'manage_fact',
    args: {
      operation: 'save',
      category: 'physical_constraint',
      fact: RECURRING_FACT,
      muscleGroup: 'shoulders_front',
      durability: 'short',
      ttlDays: 5,
      onExpiry: 'ask_once',
    },
  },
} as const;

const retract = {
  toolCall: { name: 'manage_fact', args: { operation: 'retract', factQuery: 'shoulder aches' } },
} as const;

export const scenario: Scenario = {
  id: 'fl-d-recurring-short-state',
  description:
    'The same short state three times: closed twice, re-stated after each closure — a three-row supersedes_id chain (two archived, one active)',
  past: pastWith([{ category: 'coaching_preference', fact: 'Prefers short, direct replies without long intros' }]),
  steps: [
    {
      action: 'user',
      text: 'Плечо опять ноет после жима',
      script: [save, { text: 'Записал.' }],
      expect: {
        persisted: {
          facts: [{ fact: RECURRING_FACT, status: 'active', count: 1, durability: 'short', supersedes: false }],
        },
      },
    },
    {
      action: 'user',
      text: 'Прошло, плечо в порядке',
      script: [retract, { text: 'Хорошо, закрыл.' }],
      expect: {
        persisted: {
          facts: [
            { fact: RECURRING_FACT, status: 'archived', count: 1, archivedReason: 'user_closed', closedByUser: true },
            { fact: RECURRING_FACT, status: 'active', count: 0 },
          ],
        },
      },
    },
    { action: 'advance', at: '+2d' },
    {
      action: 'user',
      text: 'Плечо снова ноет после жима',
      script: [save, { text: 'Записал заново.' }],
      expect: {
        persisted: {
          facts: [
            { fact: RECURRING_FACT, status: 'archived', count: 1 },
            { fact: RECURRING_FACT, status: 'active', count: 1, supersedes: true },
          ],
        },
      },
    },
    {
      action: 'user',
      text: 'Опять прошло',
      script: [retract, { text: 'Закрыл.' }],
      expect: {
        persisted: {
          facts: [
            { fact: RECURRING_FACT, status: 'archived', count: 2, archivedReason: 'user_closed', closedByUser: true },
            { fact: RECURRING_FACT, status: 'active', count: 0 },
          ],
        },
      },
    },
    { action: 'advance', at: '+4d' },
    {
      action: 'user',
      text: 'И в третий раз ноет после жима',
      script: [save, { text: 'Записал.' }],
      expect: {
        // The chain a promotion would count: two archived rows and one active, linked.
        persisted: {
          facts: [
            { fact: RECURRING_FACT, status: 'archived', count: 2, archivedReason: 'user_closed', closedByUser: true },
            { fact: RECURRING_FACT, status: 'active', count: 1, supersedes: true, durability: 'short' },
          ],
        },
      },
    },
  ],
};
