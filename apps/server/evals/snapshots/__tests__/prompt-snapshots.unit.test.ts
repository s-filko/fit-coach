/**
 * AC-1321 — pre-refactor truth. Captured from the OLD builders in
 * refactor-p2-prompt-modules Task 1 and never regenerated in that plan.
 * Fake timers pin `new Date()` inside the old builders to FIXED_NOW.
 */
import { compose, sectionText } from '@infra/ai/prompts/compose';
import {
  HISTORY_FRAME_V1,
  POST_TOOL_NUDGE_V1,
  SUMMARY_FRAME_V1,
  TOOL_RESULTS_V1,
  renderBlock,
} from '@infra/ai/prompts/blocks';
import { CHAT_PROMPT } from '@infra/ai/prompts/phases/chat';
import { PLAN_CREATION_PROMPT } from '@infra/ai/prompts/phases/plan_creation';
import { REGISTRATION_PROMPT } from '@infra/ai/prompts/phases/registration';
import { SESSION_PLANNING_PROMPT } from '@infra/ai/prompts/phases/session_planning';
import { TRAINING_PROMPT } from '@infra/ai/prompts/phases/training';
import { SUMMARIZER_PROMPT } from '@infra/ai/prompts/summarizer';

import { ALL_FIXTURES } from '../../fixtures/personas';
import {
  FIXED_NOW,
  FIXTURE_HISTORY,
  FIXTURE_SUMMARY,
  FIXTURE_TOOL_RESULTS,
  buildFixtureSession,
  buildSessionPlanningContext,
  toUser,
} from '../../fixtures/prompt-contexts';

const LAST_MESSAGE_YESTERDAY = new Date('2026-09-12T08:00:00.000Z');

describe('prompt snapshots (AC-1321, BR-LLM-007 — byte-identical across the P2 move)', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: FIXED_NOW });
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  for (const { name, fixture } of ALL_FIXTURES) {
    const user = toUser(fixture);

    it(`phase.registration / ${name}`, () => {
      const ctx = { now: FIXED_NOW, timezone: user.timezone ?? null, client: 'telegram' as const, user, lastMessageTime: null };
      expect(compose(REGISTRATION_PROMPT.current.render(ctx))).toMatchSnapshot();
    });

    it(`phase.chat / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: LAST_MESSAGE_YESTERDAY,
        hasActivePlan: fixture.hasActivePlan ?? false,
        recentSessions: [],
      };
      expect(compose(CHAT_PROMPT.current.render(ctx))).toMatchSnapshot();
    });

    it(`phase.plan_creation / ${name}`, () => {
      const ctx = { now: FIXED_NOW, timezone: user.timezone ?? null, client: 'telegram' as const, user, lastMessageTime: null };
      expect(compose(PLAN_CREATION_PROMPT.current.render(ctx))).toMatchSnapshot();
    });

    it(`phase.session_planning / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
        context: buildSessionPlanningContext(fixture, FIXED_NOW),
      };
      expect(compose(SESSION_PLANNING_PROMPT.current.render(ctx))).toMatchSnapshot();
    });

    it(`phase.training / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
        session: buildFixtureSession(fixture, FIXED_NOW),
        previousSession: null,
      };
      expect(compose(TRAINING_PROMPT.current.render(ctx))).toMatchSnapshot();
    });
  }

  it('summarizer / system', () => {
    const sections = SUMMARIZER_PROMPT.render({ phase: 'training', previousSummary: FIXTURE_SUMMARY, history: FIXTURE_HISTORY });
    expect(sectionText(sections, 'system')).toMatchSnapshot();
  });

  it('summarizer / user (with previous summary)', () => {
    const sections = SUMMARIZER_PROMPT.render({ phase: 'training', previousSummary: FIXTURE_SUMMARY, history: FIXTURE_HISTORY });
    expect(sectionText(sections, 'user')).toMatchSnapshot();
  });

  it('summarizer / user (no previous summary)', () => {
    const sections = SUMMARIZER_PROMPT.render({ phase: 'chat', previousSummary: null, history: FIXTURE_HISTORY });
    expect(sectionText(sections, 'user')).toMatchSnapshot();
  });

  it('block.tool_results / mixed', () => {
    expect(renderBlock(TOOL_RESULTS_V1, { results: FIXTURE_TOOL_RESULTS })).toMatchSnapshot();
  });

  it('block.history_frame / two turns', () => {
    expect(renderBlock(HISTORY_FRAME_V1, { history: FIXTURE_HISTORY })).toMatchSnapshot();
  });

  it('block.history_frame / empty', () => {
    expect(renderBlock(HISTORY_FRAME_V1, { history: [] })).toMatchSnapshot();
  });

  it('block.summary_frame / present', () => {
    expect(renderBlock(SUMMARY_FRAME_V1, { previousSummary: FIXTURE_SUMMARY })).toMatchSnapshot();
  });

  it('block.post_tool_nudge', () => {
    expect(renderBlock(POST_TOOL_NUDGE_V1, {})).toMatchSnapshot();
  });
});
