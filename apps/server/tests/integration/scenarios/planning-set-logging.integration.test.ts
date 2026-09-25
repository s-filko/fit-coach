/**
 * PROMOTED from planning-set-logging.repro.test.ts (AC-CB-2 / BUG-022, roadmap
 * R0.1) when U5 `transition-handoff` (R2.1) landed — AC-TH-1/AC-TH-2/AC-TH-3.
 *
 * With `TRANSITION_HANDOFF_TARGETS=training`, a set reported during
 * session_planning opens training in the SAME run (`start_training_session`
 * hands off silently) and training logs it before anything is confirmed to
 * the user — BUG-022 closed structurally, not by adding log_set to planning.
 */
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { conversationRuns, conversationTurns, workoutSessions } from '@infra/db/schema';

import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import { ScenarioSchema, type Scenario } from '../../../evals/schema/scenario.schema';
import { BENCH_PRESS_ID, sharedPast, setupSteps } from '../../../evals/scenarios/b-full-workout.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';
import { storedSets } from './session-seed';

/** The scenario's weekday labels in the imported setup steps are pinned to this T0. */
const T0 = new Date('2026-09-20T10:00:00.000Z');

const SET_REPORT = 'сделал 2 подхода 110×12 на жиме ногами';
const CLOSING_TEXT = 'Записал: 110 × 12. Продолжаем?';

const planningSetScenario: Scenario = {
  id: 'r01-planning-set-logging',
  description: 'a set reported during session_planning opens training in the same run (BUG-022, AC-TH-1)',
  past: sharedPast,
  steps: [
    ...setupSteps.slice(0, 2), // chat → session_planning → proposal; training NOT started
    {
      action: 'user',
      text: SET_REPORT,
      script: [
        // session_planning: no text — the hand-off empties it anyway (AC-TH-2).
        {
          toolCall: {
            name: 'start_training_session',
            args: {
              sessionKey: 'upper_a',
              sessionName: 'Upper A',
              reasoning: 'The user is training right now — open the session and log what they already did.',
              exercises: [
                { exerciseId: BENCH_PRESS_ID, exerciseName: 'Barbell Bench Press', targetSets: 3, targetReps: '8-10', restSeconds: 120 },
              ],
              estimatedDuration: 45,
            },
          },
        },
        // training, same run (the hop): logs the reported set, then answers.
        { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 12, weight: 110 } } },
        { text: CLOSING_TEXT },
      ],
      expect: {},
    },
  ],
};

describe('U5 transition-handoff — a set reported during session_planning', () => {
  let result: ScenarioRunResult;
  let model: ScriptedModelHandle;
  let previousFlag: string | undefined;

  beforeAll(async () => {
    expect(ScenarioSchema.parse(planningSetScenario)).toBeTruthy(); // the scenario is format-valid
    previousFlag = process.env.TRANSITION_HANDOFF_TARGETS;
    process.env.TRANSITION_HANDOFF_TARGETS = 'training';
    model = installScriptedModel();
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    for (const step of planningSetScenario.steps) {
      if (step.action === 'user') {
        model.enqueueChat(step.script ?? []);
      }
    }

    result = await runScenario(planningSetScenario, {
      onAdvance: now => jest.setSystemTime(now),
    });
  });

  afterAll(() => {
    jest.useRealTimers();
    if (previousFlag === undefined) {
      delete process.env.TRANSITION_HANDOFF_TARGETS;
    } else {
      process.env.TRANSITION_HANDOFF_TARGETS = previousFlag;
    }
  });

  it('control: the setup reaches session_planning before the set is reported', () => {
    // index 1 = setupSteps[1], "давай верх" — the proposal step, run right
    // before the set-report step (index 2).
    const [, proposalStep] = result.steps;
    expect(proposalStep?.action).toBe('user');
    expect(proposalStep?.phase).toBe('session_planning');
  });

  it('AC-TH-1: the same run commits training, and stores the reported set', async () => {
    const setReportStep = result.steps[2];
    expect(setReportStep?.phase).toBe('training');

    const sets = await storedSets(result.userId);

    expect(sets.map(s => s.setData)).toContainEqual(expect.objectContaining({ reps: 12, weight: 110 }));
  });

  it('AC-TH-2: only training’s reply is delivered — no session_planning text, no "Session created" wording', () => {
    const delivered = result.steps[2]?.delivered ?? '';
    expect(delivered).toBe(CLOSING_TEXT);
    expect(delivered).not.toContain('Session created');
    expect(delivered).not.toContain('Записал второй подход');
  });

  it('AC-TH-3: one conversation_runs row for the whole hop — phase_in/out and transition.path', async () => {
    const runId = result.steps[2]?.runRow?.runId;
    expect(runId).toBeDefined();

    const [row] = await db.select().from(conversationRuns).where(eq(conversationRuns.runId, runId as string));
    expect(row?.phaseIn).toBe('session_planning');
    expect(row?.phaseOut).toBe('training');
    expect(row?.transition).toMatchObject({
      toPhase: 'training',
      path: ['session_planning', 'training'],
    });
    expect(row?.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'start_training_session' }),
        expect.objectContaining({ name: 'log_set' }),
      ]),
    );

    // No duplicate transcript rows: every (kind, content, phase) triple of
    // this run appears exactly once.
    const turns = await db
      .select({ kind: conversationTurns.kind, content: conversationTurns.content, phase: conversationTurns.phase })
      .from(conversationTurns)
      .where(and(eq(conversationTurns.runId, runId as string)));
    const keys = turns.map(t => `${t.phase}:${t.kind}:${t.content}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Each row carries the phase that wrote it — both phases show up.
    expect(turns.some(t => t.phase === 'session_planning')).toBe(true);
    expect(turns.some(t => t.phase === 'training')).toBe(true);
  });

  it('AC-TH-4: the hop keeps the first commit’s side effects — session in_progress, activeSessionId set', async () => {
    // sharedPast seeds two already-completed workouts — the JUST-created
    // session (this run's start_training_session) is the newest one.
    const [session] = await db
      .select({ status: workoutSessions.status })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, result.userId))
      .orderBy(desc(workoutSessions.createdAt))
      .limit(1);

    expect(session?.status).toBe('in_progress');
  });
});
