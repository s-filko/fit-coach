import type { Scenario } from '../schema/scenario.schema';

import { directive, pastWith, summary } from './fl-shared';

/**
 * Journey FL-C — a short state that expires silently versus one that asks
 * once (course-check plan Task 3 / AC-FL-7; the owner's "short" class).
 *
 * Two `short` facts stated at T0 with a 3-day TTL: leg soreness after squats
 * (`on_expiry: forget` — certainly resolves) and a shoulder tweak
 * (`on_expiry: ask_once` — may leave a trace). Before the expiry the course
 * check sees BOTH with their flags — the input is what carries the
 * forget/ask_once distinction to the model — and after it both are hidden
 * from the prompt and the check alike. The database keeps the rows (expiry
 * hides, it neither deletes nor archives) with their flags and dates intact.
 *
 * What is NOT here: the ask itself. Nothing yet asks about an `ask_once` fact
 * AFTER it expires — an expired fact never reaches the course check, and
 * nothing records that a question was put. See the it.todo in the test file.
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
      script: [{ text: 'С возвращением! Начнём с разминки?' }],
      expect: {
        // Expired: both gone from what the model sees…
        seen: { mustNotMatch: [DOMS_FACT, SHOULDER_TWEAK] },
        // …but expiry hides, it does not erase: the rows keep their flags and dates.
        persisted: {
          facts: [
            { fact: DOMS_FACT, status: 'active', durability: 'short', onExpiry: 'forget', expiresAt: '+3d' },
            { fact: SHOULDER_TWEAK, status: 'active', durability: 'short', onExpiry: 'ask_once', expiresAt: '+3d' },
          ],
        },
      },
    },
  ],
};
