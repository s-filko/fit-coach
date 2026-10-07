import type { Scenario } from '../schema/scenario.schema';

/**
 * Journey m — no false logging claim in plan_creation (coach-quality-proof T1 /
 * AC-CQ-1, BUG-052): the user reports a set while a workout plan is being
 * created. plan_creation has no logging tool, so nothing can be stored — yet the
 * buggy coach answers «Записал…». The journey reproduces the claim (the scripted
 * reply says it) and pins what must hold instead: no `log_set` call (nothing
 * exists to call) and no «Записал» in the delivered text — the latter tagged
 * `knownBug BUG-052`, expected to fail until the fix lands.
 */
const PLAN_REQUEST = 'хочу составить план тренировок';
const PLAN_INTRO_TEXT = 'Отлично, давай составим план. Какие у тебя цели?';
const PLAN_FINAL_TEXT = 'Расскажи, какой у тебя опыт и что хочешь прокачать.';
const FALSE_LOG_TEXT = 'Записал: жим лёжа 60 кг × 10.';

export const scenario: Scenario = {
  id: 'm-no-false-log',
  description:
    'in plan_creation, a reported set («сделал жим 60 на 10») is not logged and must not be claimed as logged (BUG-052, knownBug until fixed)',
  past: {
    user: {
      languageCode: 'ru',
      timezone: 'Europe/Berlin',
      firstName: 'Alex',
      age: 30,
      gender: 'male',
      height: 180,
      weight: 80,
      fitnessLevel: 'intermediate',
      fitnessGoal: 'strength',
      registrationCompleted: true,
    },
    facts: [],
    workouts: [],
  },
  steps: [
    // --- step 0: chat → plan_creation (no active plan, no sessions) ---
    {
      action: 'user',
      text: PLAN_REQUEST,
      script: [
        {
          text: PLAN_INTRO_TEXT,
          toolCall: { name: 'request_transition', args: { toPhase: 'plan_creation', reason: 'user wants a workout plan' } },
        },
        { text: PLAN_FINAL_TEXT },
      ],
      expect: {
        tools: { must: ['request_transition'] },
        delivered: { mustMatch: [PLAN_INTRO_TEXT] },
        persisted: { turnRecorded: true },
        phaseAfter: { phase: 'plan_creation' },
      },
    },
    // --- step 1: the reported set — nothing can be logged here ---
    {
      action: 'user',
      text: 'сделал жим 60 на 10',
      script: [{ text: FALSE_LOG_TEXT }],
      expect: {
        // Nothing was stored: the phase has no logging tool at all.
        tools: { mustNot: ['log_set'] },
        // BUG-052: the claim of logging must not appear — it does today, so the
        // assertion runs as knownBug (test.failing in the deterministic layer,
        // a known-bug reproduction in the live report).
        delivered: { mustNotMatch: [{ text: 'Записал', knownBug: 'BUG-052' }] },
        phaseAfter: { phase: 'plan_creation' },
      },
    },
  ],
};
