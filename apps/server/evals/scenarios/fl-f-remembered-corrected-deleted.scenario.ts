import type { Scenario } from '../schema/scenario.schema';

import { pastWith } from './fl-shared';

/**
 * Journey FL-F — "what do you remember?", then one fact corrected and one
 * deleted outright, then "what do you remember now?" (course-check plan
 * Task 3 / AC-FL-7, the fact-lifecycle plan's AC-FL-8).
 *
 * The user asks what the coach remembers (`list_facts`); says the knee is
 * actually the RIGHT one (a correction: same row, rewritten text, one more
 * confirmation) and asks to erase the sleep note entirely (`delete`). Owner
 * decision 2026-09-21: nothing is ever removed — `delete` ARCHIVES the row with
 * its own reason (`user_deleted`) while the coach tells the user it is gone, and
 * a deleted fact is not shown again, not even when the listing asks for archived
 * facts. The next listing (with `includeArchived`) reflects both. The ending is
 * in the database: the corrected row carries the new text under the same id, and
 * the deleted one is an ARCHIVED `user_deleted` row (history kept for any
 * recurrence count) that no listing shows.
 */

export const KNEE_OLD = 'Left knee: recovering from a meniscus repair';
export const KNEE_NEW = 'Right knee: recovering from a meniscus repair';
export const SLEEP_FACT = 'Sleeps badly before early trainings';
export const EQUIPMENT_FACT = 'Trains at home with a barbell and a squat rack';

export const scenario: Scenario = {
  id: 'fl-f-remembered-corrected-deleted',
  description:
    'The user asks what is remembered, has one fact corrected and one deleted outright — the next listing and the database reflect both',
  past: pastWith([
    { category: 'equipment', fact: EQUIPMENT_FACT },
    {
      category: 'physical_constraint',
      fact: KNEE_OLD,
      muscleGroup: 'quads',
      durability: 'long_term',
      at: '-3d',
      reviewInDays: 30,
      phaseNote: 'brace off',
    },
    {
      category: 'physiological_pattern',
      fact: SLEEP_FACT,
      durability: 'long_term',
      at: '-3d',
      reviewInDays: 30,
    },
  ]),
  steps: [
    {
      action: 'user',
      text: 'Что ты обо мне помнишь?',
      script: [
        { toolCall: { name: 'list_facts', args: {} } },
        {
          text: 'Помню: домашний зал со штангой, восстановление левого колена и плохой сон перед ранними тренировками.',
        },
      ],
      expect: {
        // The tool result the model was handed: every active fact, with ids.
        seen: { mustMatch: ['Active facts:', '- id ', EQUIPMENT_FACT, KNEE_OLD, SLEEP_FACT] },
        tools: { must: ['list_facts'] },
        persisted: {
          facts: [
            { fact: EQUIPMENT_FACT, status: 'active' },
            { fact: KNEE_OLD, status: 'active' },
            { fact: SLEEP_FACT, status: 'active' },
          ],
        },
      },
    },
    {
      action: 'user',
      text: 'Колено на самом деле правое. А про сон сотри совсем — не хочу, чтобы это хранилось',
      script: [
        {
          toolCall: {
            name: 'manage_fact',
            args: {
              operation: 'save',
              factId: '{{factId:Left knee}}',
              category: 'physical_constraint',
              fact: KNEE_NEW,
              muscleGroup: 'quads',
              durability: 'long_term',
              reviewInDays: 30,
              phaseNote: 'brace off',
            },
          },
        },
        {
          toolCall: {
            name: 'manage_fact',
            args: { operation: 'delete', factQuery: 'Sleeps badly' },
          },
        },
        { text: 'Поправил: правое колено. Запись про сон удалена полностью.' },
      ],
      expect: {
        tools: { must: ['manage_fact'] },
        persisted: {
          facts: [
            // Corrected IN PLACE: the new text, one more confirmation, no second row.
            { fact: KNEE_NEW, status: 'active', count: 1, confirmations: 2, supersedes: false },
            { fact: KNEE_OLD, count: 0 },
            { fact: EQUIPMENT_FACT, status: 'active' },
            // Deleted = ARCHIVED under its own reason, the user's word stamped — never removed.
            {
              fact: SLEEP_FACT,
              status: 'archived',
              count: 1,
              archivedReason: 'user_deleted',
              closedByUser: true,
              confirmations: 1,
            },
          ],
        },
      },
    },
    {
      action: 'user',
      text: 'Что ты помнишь теперь?',
      script: [
        // includeArchived: the deleted fact must STILL not surface.
        { toolCall: { name: 'list_facts', args: { includeArchived: true } } },
        { text: 'Теперь: домашний зал со штангой и восстановление правого колена.' },
      ],
      expect: {
        // The listing itself is asserted by the test on the LAST tool result (the history still carries step 0's).
        seen: { mustMatch: [KNEE_NEW] },
        tools: { must: ['list_facts'] },
        persisted: {
          facts: [
            { fact: KNEE_NEW, status: 'active', count: 1 },
            { fact: EQUIPMENT_FACT, status: 'active' },
            // Asking again changes nothing: still exactly one archived user_deleted row.
            { fact: SLEEP_FACT, status: 'archived', count: 1, archivedReason: 'user_deleted' },
          ],
          factsAbsent: [KNEE_OLD], // the old text is gone (rewritten in place), not archived
        },
      },
    },
  ],
};
