/**
 * AC-1321 — pre-refactor truth. Captured from the OLD builders in
 * refactor-p2-prompt-modules Task 1 and never regenerated in that plan.
 * Fake timers pin `new Date()` inside the old builders to FIXED_NOW.
 */
import { EPISODE_SUMMARIES_V1, POST_TOOL_NUDGE_V1, renderBlock } from '@infra/ai/prompts/blocks';
import { compose, sectionText } from '@infra/ai/prompts/compose';
import { CHAT_PROMPT } from '@infra/ai/prompts/phases/chat';
import { PLAN_CREATION_PROMPT } from '@infra/ai/prompts/phases/plan_creation';
import { REGISTRATION_PROMPT } from '@infra/ai/prompts/phases/registration';
import { SESSION_PLANNING_PROMPT } from '@infra/ai/prompts/phases/session_planning';
import { TRAINING_PROMPT } from '@infra/ai/prompts/phases/training';
import { SUMMARIZER_PROMPT, SUMMARIZER_V1 } from '@infra/ai/prompts/summarizer';

import { ALL_FIXTURES } from '../../fixtures/personas';
import {
  buildFixtureSession,
  buildSessionPlanningContext,
  FIXED_NOW,
  FIXTURE_EPISODE_SUMMARY,
  FIXTURE_HISTORY,
  FIXTURE_SUMMARY,
  FIXTURE_TRANSCRIPT,
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
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
      };
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
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
      };
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

  // v1 is the frozen pre-P4 rolling summariser — kept for the record; v2 is current.
  it('summarizer / system', () => {
    const sections = SUMMARIZER_V1.render({
      phase: 'training',
      previousSummary: FIXTURE_SUMMARY,
      history: FIXTURE_HISTORY,
    });
    expect(sectionText(sections, 'system')).toMatchSnapshot();
  });

  it('summarizer / user (with previous summary)', () => {
    const sections = SUMMARIZER_V1.render({
      phase: 'training',
      previousSummary: FIXTURE_SUMMARY,
      history: FIXTURE_HISTORY,
    });
    expect(sectionText(sections, 'user')).toMatchSnapshot();
  });

  it('summarizer / user (no previous summary)', () => {
    const sections = SUMMARIZER_V1.render({ phase: 'chat', previousSummary: null, history: FIXTURE_HISTORY });
    expect(sectionText(sections, 'user')).toMatchSnapshot();
  });

  it('summarizer v2 / system (structured episode summary — BR-LLM-004, ADR-0010)', () => {
    const sections = SUMMARIZER_PROMPT.render({ phase: 'training', transcript: FIXTURE_TRANSCRIPT });
    expect(sectionText(sections, 'system')).toMatchSnapshot();
  });

  it('summarizer v2 / user (rendered transcript only — no previousSummary)', () => {
    const sections = SUMMARIZER_PROMPT.render({ phase: 'training', transcript: FIXTURE_TRANSCRIPT });
    expect(sectionText(sections, 'user')).toMatchSnapshot();
  });

  it('block.episode_summaries / present', () => {
    expect(
      renderBlock(EPISODE_SUMMARIES_V1, { summaries: [FIXTURE_EPISODE_SUMMARY], now: FIXED_NOW, timezone: 'Europe/Berlin' }),
    ).toMatchSnapshot();
  });

  it('block.episode_summaries / empty renders nothing', () => {
    expect(renderBlock(EPISODE_SUMMARIES_V1, { summaries: [], now: FIXED_NOW, timezone: null })).toBe('');
  });

  it('block.post_tool_nudge', () => {
    expect(renderBlock(POST_TOOL_NUDGE_V1, {})).toMatchSnapshot();
  });
});
