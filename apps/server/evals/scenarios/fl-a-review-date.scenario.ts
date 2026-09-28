import type { Scenario } from '../schema/scenario.schema';

import { directive, pastWith, summary } from './fl-shared';

/**
 * Journey FL-A — a long-term injury whose review date arrives (course-check
 * plan Task 3 / AC-FL-7; the owner's "long-term" class).
 *
 * The user's left knee is in recovery after a meniscus repair: a `long_term`
 * fact stated 20 days before T0 with the minimum 14-day review window, so its
 * review date passed six days ago. Story: the coach asks ONE specific question
 * about it (the course check's job — on a course-check-OFF run there is no
 * such layer and the question is not guaranteed); the user answers; the answer
 * UPDATES the fact and MOVES the date. The ending is in the database: the same
 * row, a rewritten phase note, `review_after` a month out, one more
 * confirmation — not in what the coach said.
 *
 * Pinned to T0 = 2026-09-21T10:00:00.000Z by the deterministic layer.
 */

export const KNEE_FACT = 'Left knee: recovering from a meniscus repair';
export const QUESTION = 'How is the left knee now — is the brace still on, and can you squat to parallel without pain?';
export const NEW_PHASE = 'brace off a week ago, squats to parallel without pain';

export const scenario: Scenario = {
  id: 'fl-a-review-date',
  description:
    'A long-term knee fact is past its review date: one specific question, the answer updates the fact and moves the date',
  past: pastWith([
    {
      category: 'physical_constraint',
      fact: KNEE_FACT,
      muscleGroup: 'quads',
      durability: 'long_term',
      at: '-20d',
      reviewInDays: 14,
      phaseNote: 'in a brace, three weeks after surgery',
    },
    { category: 'coaching_preference', fact: 'Prefers short, direct replies without long intros' },
  ]),
  steps: [
    {
      action: 'user',
      text: 'Привет, хочу обсудить нагрузку на эту неделю',
      structured: {
        courseCheck: directive({
          vector: 'Return to squatting after knee surgery',
          constraints: ['Left knee: no deep loaded flexion until cleared'],
          questions: [QUESTION],
        }),
      },
      script: [
        {
          text: 'Привет! Прежде чем планировать — как левое колено? Бандаж уже сняли, приседаешь до параллели без боли?',
        },
      ],
      expect: {
        seen: {
          mustMatch: [
            '## User Facts',
            KNEE_FACT,
            { text: '## Course Directive', courseCheckOnly: true },
            { text: QUESTION, courseCheckOnly: true },
          ],
        },
        delivered: { mustMatch: ['как левое колено'] },
        // Asking changes nothing: the row is untouched and its review date is still six days ago.
        persisted: {
          facts: [
            {
              fact: KNEE_FACT,
              status: 'active',
              durability: 'long_term',
              reviewAfter: '-6d',
              phaseNote: 'in a brace, three weeks after surgery',
              confirmations: 1,
            },
          ],
        },
      },
    },
    {
      action: 'user',
      text: 'Бандаж сняли неделю назад, приседаю до параллели без боли',
      script: [
        {
          toolCall: {
            name: 'manage_fact',
            args: {
              operation: 'save',
              factId: '{{factId:Left knee}}',
              category: 'physical_constraint',
              fact: KNEE_FACT,
              muscleGroup: 'quads',
              durability: 'long_term',
              reviewInDays: 30,
              phaseNote: NEW_PHASE,
            },
          },
        },
        { text: 'Отлично, записал: бандаж снят. Следующая сверка через месяц.' },
      ],
      expect: {
        tools: { must: ['manage_fact'] },
        delivered: { mustMatch: ['Следующая сверка через месяц'] },
        // The ending, in the database: SAME row, phase note rewritten, review date moved a month out.
        persisted: {
          facts: [
            {
              fact: KNEE_FACT,
              status: 'active',
              count: 1,
              durability: 'long_term',
              reviewAfter: '+30d',
              phaseNote: NEW_PHASE,
              confirmations: 2,
              supersedes: false,
            },
          ],
        },
      },
    },
    {
      action: 'user',
      text: 'Что дальше по тренировкам?',
      structured: {
        courseCheck: directive({
          vector: 'Reintroduce squats gradually',
          constraints: [],
          questions: [],
        }),
      },
      script: [{ text: 'Тогда вернём приседания в план, начнём с лёгких весов.' }],
      expect: {
        seen: { mustMatch: [{ text: '## Course Directive', courseCheckOnly: true }, KNEE_FACT] },
        // Nothing asked, nothing changed: still one row, still a month out.
        persisted: { facts: [{ fact: KNEE_FACT, status: 'active', count: 1, reviewAfter: '+30d' }] },
      },
    },
  ],
};
