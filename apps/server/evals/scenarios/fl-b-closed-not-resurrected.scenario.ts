import type { Scenario } from '../schema/scenario.schema';

import { directive, pastWith, summary } from './fl-shared';

/**
 * Journey FL-B — "it's fine now" closes a fact, and old evidence cannot
 * resurrect it (course-check plan Task 3 / AC-FL-7; the owner's "the user's
 * word wins, immediately", in his own words).
 *
 * Story: the user says the shoulder is fine → `manage_fact retract` → the row
 * is ARCHIVED (`user_closed`, `closed_by_user_at` set). Hours later the next
 * run compacts the previous episode — whose summariser still states the
 * shoulder pain, because the conversation did contain it — and its operations
 * try to bring the fact back three ways: `add`, `update` (supersede) and
 * `confirm`. The evidence clock (the episode's newest user message) is not
 * newer than the closure, so NONE of them may act. The ending is in the
 * database: one row for that key, still archived, still `user_closed`, the
 * confirmation counter untouched, and NO new active row — a resurrection would
 * show up as a second row or as `status = 'active'`.
 *
 * Deterministic layer only for the compaction part: it needs
 * EPISODE_KEEP_TURNS=0 / MIN_TURNS=0 / MIN_TOKENS=0 (set by the test) so a
 * two-turn episode compacts at all, and a scripted summariser.
 */

export const SHOULDER_FACT = 'Right shoulder pain when pressing overhead';

const SHOULDER_NEW_STATEMENT = {
  category: 'physical_constraint',
  fact: SHOULDER_FACT,
  muscleGroup: 'shoulders_front',
  durability: 'long_term',
  reviewInDays: 30,
  phaseNote: 'after a fall',
};

export const scenario: Scenario = {
  id: 'fl-b-closed-not-resurrected',
  description:
    'The user closes a fact ("it\'s fine now"); a later compaction of the older episode tries add/update/confirm — the row stays archived and no new one appears',
  past: pastWith([
    {
      category: 'physical_constraint',
      fact: SHOULDER_FACT,
      muscleGroup: 'shoulders_front',
      durability: 'long_term',
      at: '-10d',
      reviewInDays: 14,
      phaseNote: 'after a fall',
    },
    { category: 'coaching_preference', fact: 'Prefers short, direct replies without long intros' },
  ]),
  steps: [
    {
      action: 'user',
      text: 'Плечо уже не болит, можно снова жать над головой',
      structured: {
        courseCheck: directive({
          vector: 'Overhead pressing while the shoulder heals',
          constraints: ['Right shoulder: pain when pressing overhead'],
          questions: [],
        }),
      },
      script: [
        { toolCall: { name: 'manage_fact', args: { operation: 'retract', factQuery: 'shoulder pain' } } },
        { text: 'Рад слышать! Больше не буду об этом спрашивать.' },
      ],
      expect: {
        tools: { must: ['manage_fact'] },
        // The ending, in the database — not in the coach's words.
        persisted: {
          facts: [
            {
              fact: SHOULDER_FACT,
              status: 'archived',
              count: 1,
              archivedReason: 'user_closed',
              closedByUser: true,
              confirmations: 1,
            },
            { fact: 'Prefers short', status: 'active' },
          ],
        },
      },
    },
    { action: 'advance', at: '+5h' },
    {
      action: 'user',
      text: 'Привет',
      structured: {
        // The summariser of the OLDER episode restates the pain three ways.
        summary: summary({
          topics: ['Overhead pressing'],
          decisions: [],
          userState: [],
          trainingFeedback: [],
          openItems: [],
          factOperations: [
            { op: 'add', ...SHOULDER_NEW_STATEMENT },
            { op: 'update', factId: '{{factId:Right shoulder}}', ...SHOULDER_NEW_STATEMENT },
            { op: 'confirm', factId: '{{factId:Right shoulder}}' },
          ],
        }),
      },
      script: [{ text: 'Привет! Чем займёмся сегодня?' }],
      expect: {
        // Never used again: not in the facts block, not in any directive.
        seen: { mustMatch: ['## User Facts', 'Prefers short'], mustNotMatch: [SHOULDER_FACT] },
        persisted: {
          facts: [
            // Exactly the one row from step 0: archived, user-closed, untouched…
            {
              fact: SHOULDER_FACT,
              status: 'archived',
              count: 1,
              archivedReason: 'user_closed',
              closedByUser: true,
              confirmations: 1,
              supersedes: false,
            },
            // …and NO active row for that key: a resurrection would be one.
            { fact: SHOULDER_FACT, status: 'active', count: 0 },
            { fact: 'Prefers short', status: 'active' },
          ],
        },
      },
    },
  ],
};
