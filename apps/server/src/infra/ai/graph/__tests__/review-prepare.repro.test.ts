/**
 * Review regression proof — Task 1, AC-RRP-2 (docs/superpowers/plans/review-regression-proof.md).
 *
 * REPRODUCTION on UNCHANGED production code: prepare reads the active session
 * with `getSessionDetails(...).catch(() => null)`, so an infrastructure failure
 * (the read REJECTS) is indistinguishable from "no such session" and is committed
 * as the domain fact `session_ended` — the user is thrown back to chat with the
 * "session ended" reply while their session is still in_progress.
 *
 * The real `buildPrepareNode` runs; only its collaborators are stubbed: the
 * training service read (the injected fault) and the compact / course-check
 * steps (no-ops, they are not under test). The controls (session really
 * missing / completed) pass and pin the recovery that must survive the fix.
 *
 * *.repro.test.ts is outside every default suite. Run explicitly:
 *   NODE_ENV=test npx jest --runInBand --testMatch='**\/review-prepare.repro.test.ts'
 * When the fix lands this file is promoted to *.unit.test.ts.
 */
import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Command } from '@langchain/langgraph';

import type { ITrainingService } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import type { ConversationStateType } from '../state';
import { buildPrepareNode } from '../nodes/prepare.node';

const SESSION_ID = 'session-1';
const USER = { id: 'u1', firstName: 'Test', languageCode: 'en', profileStatus: 'complete' };

const config = {
  configurable: { thread_id: 'u1' },
  context: {
    runId: 'run-rrp-2',
    userId: 'u1',
    user: USER,
    now: new Date(),
    client: 'telegram',
    trigger: 'user_message',
    metrics: new RunMetricsCollector('run-rrp-2'),
  },
} as unknown as RunnableConfig;

const trainingState = {
  phase: 'training',
  activeSessionId: SESSION_ID,
  episodeId: 'ep-1',
  messages: [],
} as unknown as ConversationStateType;

function buildPrepare(getSessionDetails: jest.Mock) {
  return buildPrepareNode({
    userService: { isRegistrationComplete: jest.fn().mockReturnValue(true) } as unknown as IUserService,
    trainingService: { getSessionDetails } as unknown as ITrainingService,
    compact: jest.fn().mockResolvedValue({}),
    courseCheck: jest.fn().mockResolvedValue({}),
  });
}

/** What prepare committed: goto, pendingTransition and the reply text, read off the returned Command. */
function outcomeOf(result: Command<Partial<ConversationStateType>>) {
  const update = (result.update ?? {}) as Partial<ConversationStateType>;
  return {
    goto: [result.goto].flat().join(','),
    pendingTransition: update.pendingTransition ?? null,
    reply: (update.messages ?? []).map(m => (m as AIMessage).content).join(' '),
  };
}

describe('review repro — prepare failure isolation (AC-RRP-2)', () => {
  describe('controls: a session that really is gone keeps the existing recovery', () => {
    it('session missing (null) → commit with session_ended', async () => {
      const result = await buildPrepare(jest.fn().mockResolvedValue(null))(trainingState, config);

      expect(outcomeOf(result)).toMatchObject({
        goto: 'commit',
        pendingTransition: { toPhase: 'chat', reason: 'session_ended' },
      });
    });

    it('session completed → commit with session_ended', async () => {
      const result = await buildPrepare(jest.fn().mockResolvedValue({ id: SESSION_ID, status: 'completed' }))(
        trainingState,
        config,
      );

      expect(outcomeOf(result)).toMatchObject({
        goto: 'commit',
        pendingTransition: { toPhase: 'chat', reason: 'session_ended' },
      });
    });

    it('session in_progress → normal route, no transition', async () => {
      const result = await buildPrepare(jest.fn().mockResolvedValue({ id: SESSION_ID, status: 'in_progress' }))(
        trainingState,
        config,
      );

      expect(outcomeOf(result)).toMatchObject({ goto: 'route', pendingTransition: null });
    });
  });

  describe('fault: the session read rejects (infrastructure failure)', () => {
    const failing = () => jest.fn().mockRejectedValue(new Error('database unavailable'));

    it('the failure propagates instead of being swallowed', async () => {
      await expect(buildPrepare(failing())(trainingState, config)).rejects.toThrow('database unavailable');
    });

    it('never produces a committed session_ended transition or the "session ended" reply', async () => {
      const outcome = await buildPrepare(failing())(trainingState, config).then(
        result => ({ rejected: false as const, ...outcomeOf(result) }),
        () => ({ rejected: true as const }),
      );

      // A rejection (technical failure) is acceptable; a successful domain transition is not.
      expect(outcome).not.toMatchObject({ pendingTransition: { reason: 'session_ended' } });
      expect(outcome).not.toMatchObject({ goto: 'commit' });
    });
  });
});
