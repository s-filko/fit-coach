/**
 * prepare (ADR-0013 §4.1, refactor-p3-run-context-commit Task 4): resets the
 * pending transition, syncs phase with profile status, and short-circuits
 * dead training states straight to commit (D-E — one path for every phase
 * change that is a conversation transition; the registration ↔ chat sync is
 * not a transition and stays a direct write).
 */
import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Command, END } from '@langchain/langgraph';

import type { ITrainingService } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import type { CourseCheckStep } from '@infra/ai/course-check/course-check.step';
import { type ConversationStateType, ctxOf } from '@infra/ai/graph/state';
import { langOf, t } from '@infra/ai/messages';

import { createLogger } from '@shared/logger';

import type { CompactStep } from './compact.node';

const log = createLogger('prepare-node');

export interface PrepareNodeDeps {
  userService: IUserService;
  trainingService: ITrainingService;
  /** The compact step (ADR-0013 §4.1): runs before the phase sync, at most once per run. */
  compact: CompactStep;
  /**
   * AC-FL-5 (course-check plan Task 1): the course-check step — after the
   * phase sync (the fingerprint reads the run's effective phase), at most one
   * structured call per run, zero on an ordinary turn.
   */
  courseCheck: CourseCheckStep;
}

export function buildPrepareNode(deps: PrepareNodeDeps) {
  const { userService, trainingService, compact, courseCheck } = deps;

  return async function prepareNode(
    state: ConversationStateType,
    config: RunnableConfig,
  ): Promise<Command<Partial<ConversationStateType>>> {
    const ctx = ctxOf(config as never);
    const { userId, user } = ctx;
    const lang = langOf(user?.languageCode);

    // Manual compaction (`/compact`): the compact step and nothing else — no
    // phase sync, no course check, no agent, no commit (so no transcript rows
    // and `lastUserMessageAt` stays). Whatever compaction returns is the whole
    // update; an empty one is the "nothing to compact" outcome.
    if (ctx.compactOnly === true) {
      return new Command({ goto: END, update: await compact(state, config) });
    }

    // Always reset — a stale blocked transition must not leak into this run.
    const updates: Partial<ConversationStateType> = { pendingTransition: null };

    // D-O: the run that starts an episode owns its id.
    if (state.episodeId === '') {
      updates.episodeId = ctx.runId;
    }

    // Compaction (BR-LLM-001..003) — before the training checks and the phase
    // sync so every path (including the short-circuits) carries its updates.
    const compactUpdates = await compact(state, config);

    // Training phase — check whether the active session has ended. NO idle
    // timeout: a session stays in_progress until explicitly closed (the
    // training loader lets the model decide on stale sessions).
    if (state.phase === 'training' && state.activeSessionId) {
      const session = await trainingService.getSessionDetails(state.activeSessionId).catch(() => null);
      const isSessionEnded = !session || session.status === 'completed' || session.status === 'skipped';
      if (isSessionEnded) {
        log.info(
          { userId, sessionId: state.activeSessionId, status: session?.status },
          'Session ended — returning to chat',
        );
        return new Command({
          goto: 'commit',
          update: {
            ...updates,
            ...compactUpdates,
            pendingTransition: { toPhase: 'chat', reason: 'session_ended' },
            // Compaction may have returned RemoveMessages — the catalog reply rides with them.
            messages: [...(compactUpdates.messages ?? []), new AIMessage(t('session_ended_return_to_chat', lang))],
          },
        });
      }
    }

    // Training without an active session: nothing inside the phase can
    // recover — return to chat immediately so the user is not stuck.
    if (state.phase === 'training' && !state.activeSessionId) {
      log.warn({ userId }, 'Training phase without activeSessionId — falling back to chat');
      return new Command({
        goto: 'commit',
        update: {
          ...updates,
          ...compactUpdates,
          pendingTransition: { toPhase: 'chat', reason: 'session_missing' },
          messages: [...(compactUpdates.messages ?? []), new AIMessage(t('session_missing_return_to_chat', lang))],
        },
      });
    }

    // Sync phase with profile status (verbatim from router.node.ts:87-98): the
    // checkpointer default is 'registration'; a complete profile advances to
    // chat, an incomplete one always stays in registration.
    if (state.phase === 'registration' && userService.isRegistrationComplete(user)) {
      updates.phase = 'chat';
    }
    if (!userService.isRegistrationComplete(user) && state.phase !== 'registration') {
      updates.phase = 'registration';
    }

    // Course check (AC-FL-5) — AFTER the phase sync so the fingerprint reads
    // the run's effective phase. The dead-training short-circuits above skip
    // it deliberately: no prompt is rendered on those runs, and the event
    // (fingerprint/gap) is still true on the next run that does render one.
    const courseUpdates = await courseCheck({ ...state, phase: updates.phase ?? state.phase }, config);

    return new Command({ goto: 'route', update: { ...updates, ...compactUpdates, ...courseUpdates } });
  };
}
