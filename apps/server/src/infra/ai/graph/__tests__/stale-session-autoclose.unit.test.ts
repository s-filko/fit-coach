/**
 * Stale session auto-close (BUG-053, stale-session-autoclose plan T1 / AC-SSA-1, review R1):
 * `prepare` DETECTS an in_progress session idle past SESSION_TIMEOUT_MS and requests the close
 * as a transition to chat (reason 'session_timeout') routed to `commit` with no canned reply —
 * the session-completion side effect is commit's (the session lifecycle handler, ADR-0013 §4.1),
 * never prepare's. A planning session and a fresh in_progress session are untouched.
 */
import type { AIMessage, BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Command } from '@langchain/langgraph';

import type { ITrainingService } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import type { ConversationStateType } from '../state';
import { buildPrepareNode } from '../nodes/prepare.node';

const T0 = new Date('2026-10-08T12:00:00.000Z');
const SESSION_ID = 'session-stale';
const USER = { id: 'u1', firstName: 'Test', languageCode: 'ru', profileStatus: 'complete' };

function configOf(): RunnableConfig {
  return {
    configurable: { thread_id: 'u1' },
    context: {
      runId: 'run-ssa-1',
      userId: 'u1',
      user: USER,
      now: T0,
      client: 'telegram',
      trigger: 'user_message',
      metrics: new RunMetricsCollector('run-ssa-1'),
    },
  } as unknown as RunnableConfig;
}

const trainingState = {
  phase: 'training',
  activeSessionId: SESSION_ID,
  episodeId: 'ep-1',
  messages: [],
} as unknown as ConversationStateType;

function buildPrepare(getSessionDetails: jest.Mock, autoCloseTimedOutSessions: jest.Mock) {
  return buildPrepareNode({
    userService: { isRegistrationComplete: jest.fn().mockReturnValue(true) } as unknown as IUserService,
    trainingService: { getSessionDetails, autoCloseTimedOutSessions } as unknown as ITrainingService,
    compact: jest.fn().mockResolvedValue({}),
    courseCheck: jest.fn().mockResolvedValue({}),
  });
}

/** What prepare returned: goto, the durable updates, and any AI messages riding along. */
function outcomeOf(result: Command<Partial<ConversationStateType>>) {
  const update = (result.update ?? {}) as Partial<ConversationStateType>;
  const aiMessages = ((update.messages ?? []) as BaseMessage[]).filter(m => m._getType() === 'ai') as AIMessage[];
  return {
    goto: [result.goto].flat().join(','),
    update,
    aiText: aiMessages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join(' '),
  };
}

/** An in_progress session whose last activity is `idleMs` before T0, with one logged set. */
function sessionIdle(idleMs: number, status = 'in_progress') {
  const at = new Date(T0.getTime() - idleMs);
  return { id: SESSION_ID, status, startedAt: at, lastActivityAt: at, exercises: [{ sets: [{ id: 'set-1' }] }] };
}

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

describe('prepare — stale session auto-close (BUG-053, AC-SSA-1)', () => {
  it('in_progress idle 3 days → a session_timeout transition to chat goes to commit; prepare closes nothing, no catalog AIMessage', async () => {
    const autoClose = jest.fn().mockResolvedValue(undefined);
    const { goto, update, aiText } = outcomeOf(
      await buildPrepare(jest.fn().mockResolvedValue(sessionIdle(THREE_DAYS_MS)), autoClose)(trainingState, configOf()),
    );

    expect(autoClose).not.toHaveBeenCalled();
    expect(goto).toBe('commit');
    expect(update.pendingTransition).toEqual({ toPhase: 'chat', reason: 'session_timeout' });
    expect(update.phase).toBeUndefined();
    expect(aiText).toBe('');
  });

  it('review closure: the course check runs for the chat phase on the timeout path and its updates ride along', async () => {
    const courseCheck = jest.fn().mockResolvedValue({ courseDirective: 'D', courseExpiryQuestions: ['Q'] });
    const node = buildPrepareNode({
      userService: { isRegistrationComplete: jest.fn().mockReturnValue(true) } as unknown as IUserService,
      trainingService: {
        getSessionDetails: jest.fn().mockResolvedValue(sessionIdle(THREE_DAYS_MS)),
        autoCloseTimedOutSessions: jest.fn(),
      } as unknown as ITrainingService,
      compact: jest.fn().mockResolvedValue({}),
      courseCheck,
    });

    const { goto, update } = outcomeOf(await node(trainingState, configOf()));

    expect(goto).toBe('commit');
    expect(courseCheck).toHaveBeenCalledWith(expect.objectContaining({ phase: 'chat' }), expect.anything());
    expect(update.courseDirective).toBe('D');
    expect(update.courseExpiryQuestions).toEqual(['Q']);
  });

  it('in_progress idle 30 min → stays in training, nothing closed', async () => {
    const autoClose = jest.fn().mockResolvedValue(undefined);
    const { goto, update } = outcomeOf(
      await buildPrepare(jest.fn().mockResolvedValue(sessionIdle(30 * 60 * 1000)), autoClose)(
        trainingState,
        configOf(),
      ),
    );

    expect(autoClose).not.toHaveBeenCalled();
    expect(goto).toBe('route');
    expect(update.phase).toBeUndefined();
    expect(update.activeSessionId).toBeUndefined();
  });

  it('in_progress idle exactly the timeout (2 h) → stays (only LONGER than the timeout closes)', async () => {
    const autoClose = jest.fn().mockResolvedValue(undefined);
    const { update } = outcomeOf(
      await buildPrepare(jest.fn().mockResolvedValue(sessionIdle(2 * 60 * 60 * 1000)), autoClose)(
        trainingState,
        configOf(),
      ),
    );

    expect(autoClose).not.toHaveBeenCalled();
    expect(update.phase).toBeUndefined();
  });

  it('planning status idle 3 days → untouched (only in_progress closes)', async () => {
    const autoClose = jest.fn().mockResolvedValue(undefined);
    const { goto, update } = outcomeOf(
      await buildPrepare(jest.fn().mockResolvedValue(sessionIdle(THREE_DAYS_MS, 'planning')), autoClose)(
        trainingState,
        configOf(),
      ),
    );

    expect(autoClose).not.toHaveBeenCalled();
    expect(goto).toBe('route');
    expect(update.phase).toBeUndefined();
    expect(update.activeSessionId).toBeUndefined();
  });
});
