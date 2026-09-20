import type { Scenario } from '../schema/scenario.schema';

import { directive, pastWith, summary } from './fl-shared';

/**
 * Journey FL-C — a short state that expires silently versus one that asks
 * once (course-check plan Task 3 / AC-FL-7; the owner's "short" class, with
 * expiry PERFORMED — AC-FL-1, AC-FL-5).
 *
 * Two `short` facts stated at T0 with a 3-day TTL: leg soreness after squats
 * (`on_expiry: forget` — certainly resolves) and a shoulder tweak
 * (`on_expiry: ask_once` — may leave a trace). Before the expiry the course
 * check sees BOTH with their flags. After it:
 * - the `forget` fact is archived silently (`archived_reason: 'expired'`) — no
 *   question, no prompt line, not even in the check's input;
 * - the `ask_once` fact reaches the check as an EXPIRED fact owed ONE question,
 *   the directive carries that question, and only then is it archived — so the
 *   next turn finds nothing due and does not ask again;
 * - both rows keep their dates and flags in the archive (the history any
 *   future recurrence counting reads), and neither counts as the user's word:
 *   `closed_by_user_at` stays null.
 * With the layer OFF nobody can ask, so both are archived without a question;
 * the database ending is the same.
 */

export const DOMS_FACT = "Legs sore after yesterday's squats (DOMS)";
export const SHOULDER_TWEAK = 'Left shoulder tweaked while pressing';

export const scenario: Scenario = {
  id: 'fl-c-short-states',
  description:
    'Two short states with a 3-day TTL — one forget, one ask_once: both flags reach the check before expiry; after it both are hidden and the rows keep their dates',
  past: pastWith([
    {
      category: 'physiological_pattern',
      fact: DOMS_FACT,
      durability: 'short',
      ttlDays: 3,
      onExpiry: 'forget',
    },
    {
      category: 'physical_constraint',
      fact: SHOULDER_TWEAK,
      muscleGroup: 'shoulders_front',
      durability: 'short',
      ttlDays: 3,
      onExpiry: 'ask_once',
    },
  ]),
  steps: [
    {
      action: 'user',
      text: 'Привет, что сегодня по плану?',
      structured: {
        courseCheck: directive({
          vector: 'General fitness, easing back in',
          constraints: [DOMS_FACT, SHOULDER_TWEAK],
          questions: ['One check-in: has the left shoulder settled?'],
        }),
      },
      script: [{ text: 'Привет! Как левое плечо, уже спокойнее?' }],
      expect: {
        seen: { mustMatch: ['## User Facts', DOMS_FACT, SHOULDER_TWEAK] },
        persisted: {
          facts: [
            { fact: DOMS_FACT, status: 'active', durability: 'short', onExpiry: 'forget', expiresAt: '+3d' },
            { fact: SHOULDER_TWEAK, status: 'active', durability: 'short', onExpiry: 'ask_once', expiresAt: '+3d' },
          ],
        },
      },
    },
    { action: 'advance', at: '+4d' },
    {
      action: 'user',
      text: 'Привет, я вернулся',
      structured: {
        courseCheck: directive({
          vector: 'General fitness, easing back in',
          questions: ['One check-in: did the left shoulder tweak leave any trace?'],
        }),
      },
      script: [{ text: 'С возвращением! Плечо после той травмы ничего не беспокоит?' }],
      expect: {
        // Expired: both gone from what the model sees — the tweak reappears ONLY as the directive's one question.
        seen: {
          mustMatch: [
            { text: '## Course Directive', courseCheckOnly: true },
            { text: 'did the left shoulder tweak leave any trace?', courseCheckOnly: true },
          ],
          mustNotMatch: [DOMS_FACT, SHOULDER_TWEAK],
        },
        // The ending, in the database: BOTH archived as expired (not the user's word), dates and flags kept.
        persisted: {
          facts: [
            {
              fact: DOMS_FACT,
              status: 'archived',
              archivedReason: 'expired',
              closedByUser: false,
              durability: 'short',
              onExpiry: 'forget',
              expiresAt: '+3d',
            },
            {
              fact: SHOULDER_TWEAK,
              status: 'archived',
              archivedReason: 'expired',
              closedByUser: false,
              durability: 'short',
              onExpiry: 'ask_once',
              expiresAt: '+3d',
            },
          ],
        },
      },
    },
    {
      action: 'user',
      text: 'Плечо в порядке, давай тренироваться',
      script: [{ text: 'Отлично, начинаем.' }],
      expect: {
        // Asked exactly once: nothing due, nothing changes.
        persisted: {
          facts: [
            { fact: DOMS_FACT, status: 'archived', archivedReason: 'expired', count: 1 },
            { fact: SHOULDER_TWEAK, status: 'archived', archivedReason: 'expired', count: 1 },
            { fact: SHOULDER_TWEAK, status: 'active', count: 0 },
          ],
        },
      },
    },
  ],
};
