/**
 * Chat → session_planning hand-off (transition-handoff plan Task 4, R2.2,
 * AC-TH-6): with `TRANSITION_HANDOFF_TARGETS=training,session_planning`, a
 * chat `request_transition(session_planning)` hands off silently — the SAME
 * run's delivered text comes from session_planning only (chat's carrier text
 * is emptied, never delivered), and ONE run row carries
 * `transition.path = ['chat', 'session_planning']`. The second case pins the
 * max-1-hop rule (AC-TH-1's guard, R2.2 side): a session_planning reply in
 * that same run that itself calls `start_training_session` commits the
 * training transition but does NOT hop again — training's model is never
 * called (the scripted queue proves it: exactly two chat calls, no third).
 *
 * Real production wiring (registerInfraServices), real graph, adapter,
 * repositories and PostgresSaver; only the ChatModel beneath the gateway is
 * replaced by the shared scripted model (scripted-model.ts).
 */
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { conversationRuns, conversationTurns, workoutSessions } from '@infra/db/schema';

import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import { ScenarioSchema, type Scenario } from '../../../evals/schema/scenario.schema';
import { BENCH_PRESS_ID, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

const T0 = new Date('2026-09-20T10:00:00.000Z');

const WHAT_TODAY = 'что делать сегодня?';
/** Chat's carrier text — scripted ALONGSIDE the transition call to prove the hand-off empties it (AC-TH-2). */
const CHAT_TEXT = 'Давай подберём тренировку.';
/** The session_planning answer the SAME run delivers (AC-TH-6). */
const PLANNING_TEXT = 'Сегодня Upper A: жим лёжа 3×8-10 @ 80 кг, подтягивания 3×6-8. Начинаем?';

const startUpperA = {
  toolCall: {
    name: 'start_training_session',
    args: {
      sessionKey: 'upper_a',
      sessionName: 'Upper A',
      reasoning: 'The user wants to start now — open the session in the same run.',
      exercises: [
        { exerciseId: BENCH_PRESS_ID, exerciseName: 'Barbell Bench Press', targetSets: 3, targetReps: '8-10', restSeconds: 120 },
      ],
      estimatedDuration: 45,
    },
  },
};

const chatToPlanning: Scenario = {
  id: 'r22-chat-to-planning',
  description: 'from chat, "что делать сегодня?" is answered by session_planning in the same run (AC-TH-6)',
  past: sharedPast,
  steps: [
    {
      action: 'user',
      text: WHAT_TODAY,
      script: [
        // chat: text + request_transition — the hand-off empties the text (AC-TH-2).
        {
          text: CHAT_TEXT,
          toolCall: { name: 'request_transition', args: { toPhase: 'session_planning', reason: 'user asks what to train today' } },
        },
        // session_planning, same run (the hop): answers the question itself.
        { text: PLANNING_TEXT },
      ],
      expect: {},
    },
  ],
};

/** Same hand-off, but session_planning's reply itself starts the session — must NOT hop again (max 1 hop). */
const chatToPlanningToTraining: Scenario = {
  id: 'r22-max-one-hop',
  description: 'a planning reply that starts the session commits training but does not hop again',
  past: sharedPast,
  steps: [
    {
      action: 'user',
      text: WHAT_TODAY,
      script: [
        { toolCall: { name: 'request_transition', args: { toPhase: 'session_planning', reason: 'user asks what to train today' } } },
        // No text — the training hand-off empties it anyway; no training call follows.
        startUpperA,
      ],
      expect: {},
    },
  ],
};

describe('U5 transition-handoff — chat → session_planning (R2.2, AC-TH-6)', () => {
  let model: ScriptedModelHandle;
  let previousFlag: string | undefined;
  let handoff: ScenarioRunResult;
  let doubleTransition: ScenarioRunResult;
  /** Chat calls recorded during the second scenario's single run (see the last `it`). */
  let doubleTransitionChatInputs: number;

  beforeAll(async () => {
    expect(ScenarioSchema.parse(chatToPlanning)).toBeTruthy();
    expect(ScenarioSchema.parse(chatToPlanningToTraining)).toBeTruthy();
    previousFlag = process.env.TRANSITION_HANDOFF_TARGETS;
    process.env.TRANSITION_HANDOFF_TARGETS = 'training,session_planning';
    model = installScriptedModel();
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);

    // Case 1: chat → session_planning hand-off (AC-TH-6).
    for (const step of chatToPlanning.steps) {
      if (step.action === 'user') {
        model.enqueueChat(step.script ?? []);
      }
    }
    handoff = await runScenario(chatToPlanning, { onAdvance: now => jest.setSystemTime(now) });

    // Case 2: the same run's planning reply itself starts the session — the
    // scripted queue proves no third (training) model call happens.
    model.reset();
    for (const step of chatToPlanningToTraining.steps) {
      if (step.action === 'user') {
        model.enqueueChat(step.script ?? []);
      }
    }
    expect(model.drainChatInputs()).toHaveLength(0); // seeding makes no chat calls
    doubleTransition = await runScenario(chatToPlanningToTraining, { onAdvance: now => jest.setSystemTime(now) });
    doubleTransitionChatInputs = model.drainChatInputs().length;
  });

  afterAll(() => {
    jest.useRealTimers();
    if (previousFlag === undefined) {
      delete process.env.TRANSITION_HANDOFF_TARGETS;
    } else {
      process.env.TRANSITION_HANDOFF_TARGETS = previousFlag;
    }
  });

  it('AC-TH-6: the same run answers from session_planning — only the planning text is delivered', () => {
    const [step] = handoff.steps;
    expect(step?.delivered).toBe(PLANNING_TEXT);
    expect(step?.delivered).not.toContain(CHAT_TEXT);
    expect(step?.phase).toBe('session_planning');
  });

  it('AC-TH-3: exactly ONE run row for the whole hop — phase_in chat, phase_out session_planning, transition.path', async () => {
    const runId = handoff.steps[0]?.runRow?.runId;
    expect(runId).toBeDefined();

    const rows = await db.select().from(conversationRuns).where(eq(conversationRuns.runId, runId as string));
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row?.phaseIn).toBe('chat');
    expect(row?.phaseOut).toBe('session_planning');
    expect(row?.transition).toMatchObject({
      toPhase: 'session_planning',
      path: ['chat', 'session_planning'],
    });
    expect(row?.toolCalls).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'request_transition' })]),
    );
  });

  it('AC-TH-3: transcript rows of the run have no duplicates, each written under its own phase', async () => {
    const runId = handoff.steps[0]?.runRow?.runId as string;
    const turns = await db
      .select({ kind: conversationTurns.kind, content: conversationTurns.content, phase: conversationTurns.phase })
      .from(conversationTurns)
      .where(and(eq(conversationTurns.runId, runId)));
    expect(turns.length).toBeGreaterThan(0);

    const keys = turns.map(t => `${t.phase}:${t.kind}:${t.content}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(turns.some(t => t.phase === 'chat')).toBe(true);
    expect(turns.some(t => t.phase === 'session_planning')).toBe(true);
  });

  it('max-1-hop: the planning reply that starts the session commits training — but does not hop again', async () => {
    const [step] = doubleTransition.steps;
    expect(step?.phase).toBe('training');

    // The committed transition has its side effects: the session exists, in_progress.
    const [session] = await db
      .select({ status: workoutSessions.status })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, doubleTransition.userId))
      .orderBy(desc(workoutSessions.createdAt))
      .limit(1);
    expect(session?.status).toBe('in_progress');

    // One run row still: phase_in chat (the run started there), phase_out training.
    const row = step?.runRow;
    expect(row?.phaseIn).toBe('chat');
    expect(row?.phaseOut).toBe('training');
    expect(row?.transition).toMatchObject({ toPhase: 'training' });
  });

  it('max-1-hop: training’s model is NOT called in that run — exactly two chat calls (chat, session_planning)', () => {
    // A second hop would consume a third scripted answer / fallback reply;
    // the recorded inputs are the direct proof of what the model was asked.
    expect(doubleTransitionChatInputs).toBe(2);
  });
});
