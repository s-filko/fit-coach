/**
 * AC-1321 — pre-refactor truth. Captured from the OLD builders in
 * refactor-p2-prompt-modules Task 1 and never regenerated in that plan.
 * Fake timers pin `new Date()` inside the old builders to FIXED_NOW.
 */
import { EPISODE_SUMMARIES_V2, POST_TOOL_NUDGE_V1, renderBlock } from '@infra/ai/prompts/blocks';
import { compose, sectionText } from '@infra/ai/prompts/compose';
import { CHAT_PROMPT, CHAT_V1, CHAT_V2 } from '@infra/ai/prompts/phases/chat';
import { PLAN_CREATION_PROMPT, PLAN_CREATION_V1, PLAN_CREATION_V2 } from '@infra/ai/prompts/phases/plan_creation';
import { REGISTRATION_PROMPT, REGISTRATION_V1 } from '@infra/ai/prompts/phases/registration';
import {
  SESSION_PLANNING_PROMPT,
  SESSION_PLANNING_V1,
  SESSION_PLANNING_V2,
} from '@infra/ai/prompts/phases/session_planning';
import { TRAINING_PROMPT, TRAINING_V1, TRAINING_V2, TRAINING_V3 } from '@infra/ai/prompts/phases/training';
import { SUMMARIZER_V1, SUMMARIZER_V2, SUMMARIZER_V3 } from '@infra/ai/prompts/summarizer';

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
      expect(compose(REGISTRATION_V1.render(ctx))).toMatchSnapshot();
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
      expect(compose(CHAT_V1.render(ctx))).toMatchSnapshot();
    });

    it(`phase.plan_creation / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
      };
      expect(compose(PLAN_CREATION_V1.render(ctx))).toMatchSnapshot();
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
      expect(compose(SESSION_PLANNING_V1.render(ctx))).toMatchSnapshot();
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
      expect(compose(TRAINING_V1.render(ctx))).toMatchSnapshot();
    });

    // v2 (P4 context-budget plan, Task 2, D-B): v1 minus the moved domain
    // sections — CHAT_PROMPT/PLAN_CREATION_PROMPT/SESSION_PLANNING_PROMPT/
    // TRAINING_PROMPT's `.current` is v2 as of this plan. New snapshots
    // (v1's stay pinned above, untouched). Training moved on to v3 (log_set
    // exerciseId rules + search_exercises): its v2 snapshot is pinned to
    // TRAINING_V2 below, v3 gets its own.
    it(`phase.chat v2 / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: LAST_MESSAGE_YESTERDAY,
        hasActivePlan: fixture.hasActivePlan ?? false,
      };
      expect(compose(CHAT_V2.render(ctx))).toMatchSnapshot();
    });

    it(`phase.plan_creation v2 / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
      };
      expect(compose(PLAN_CREATION_V2.render(ctx))).toMatchSnapshot();
    });

    it(`phase.session_planning v2 / ${name}`, () => {
      const { daysSinceLastWorkout } = buildSessionPlanningContext(fixture, FIXED_NOW);
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
        context: { daysSinceLastWorkout },
      };
      expect(compose(SESSION_PLANNING_V2.render(ctx))).toMatchSnapshot();
    });

    it(`phase.training v2 / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
      };
      expect(compose(TRAINING_V2.render(ctx))).toMatchSnapshot();
    });

    it(`phase.training v3 / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
      };
      expect(compose(TRAINING_V3.render(ctx))).toMatchSnapshot();
    });

    // v_next (transition-handoff plan Task 7, BUG-032): every `.current`
    // phase module gains `directive.current-time` (DEFAULT_DIRECTIVES_V2 /
    // DIRECTIVES_WITHOUT_IDENTITY_V2), rendered LAST — new snapshots; every
    // block above stays pinned to its own frozen export, untouched.
    it(`phase.registration v2 / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
      };
      expect(compose(REGISTRATION_PROMPT.current.render(ctx))).toMatchSnapshot();
    });

    it(`phase.chat v3 / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: LAST_MESSAGE_YESTERDAY,
        hasActivePlan: fixture.hasActivePlan ?? false,
      };
      expect(compose(CHAT_PROMPT.current.render(ctx))).toMatchSnapshot();
    });

    it(`phase.plan_creation v3 / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
      };
      expect(compose(PLAN_CREATION_PROMPT.current.render(ctx))).toMatchSnapshot();
    });

    it(`phase.session_planning v3 / ${name}`, () => {
      const { daysSinceLastWorkout } = buildSessionPlanningContext(fixture, FIXED_NOW);
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
        context: { daysSinceLastWorkout },
      };
      expect(compose(SESSION_PLANNING_PROMPT.current.render(ctx))).toMatchSnapshot();
    });

    it(`phase.training v4 / ${name}`, () => {
      const ctx = {
        now: FIXED_NOW,
        timezone: user.timezone ?? null,
        client: 'telegram' as const,
        user,
        lastMessageTime: null,
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

  // v2 is frozen for the record (referenced directly, not via the moving SUMMARIZER_PROMPT
  // alias) — v3 is current as of P6 Task 2.
  it('summarizer v2 / system (structured episode summary — BR-LLM-004, ADR-0010)', () => {
    const sections = SUMMARIZER_V2.render({ phase: 'training', transcript: FIXTURE_TRANSCRIPT });
    expect(sectionText(sections, 'system')).toMatchSnapshot();
  });

  it('summarizer v2 / user (rendered transcript only — no previousSummary)', () => {
    const sections = SUMMARIZER_V2.render({ phase: 'training', transcript: FIXTURE_TRANSCRIPT });
    expect(sectionText(sections, 'user')).toMatchSnapshot();
  });

  it('summarizer v3 / system (adds the facts field — P6 Task 2, owner decision 2026-09-17)', () => {
    const sections = SUMMARIZER_V3.render({ phase: 'training', transcript: FIXTURE_TRANSCRIPT });
    expect(sectionText(sections, 'system')).toMatchSnapshot();
  });

  it('summarizer v3 / user (rendered transcript only — no previousSummary)', () => {
    const sections = SUMMARIZER_V3.render({ phase: 'training', transcript: FIXTURE_TRANSCRIPT });
    expect(sectionText(sections, 'user')).toMatchSnapshot();
  });

  it('block.episode_summaries / present', () => {
    expect(
      renderBlock(EPISODE_SUMMARIES_V2, {
        summaries: [FIXTURE_EPISODE_SUMMARY],
        now: FIXED_NOW,
        timezone: 'Europe/Berlin',
      }),
    ).toMatchSnapshot();
  });

  it('block.episode_summaries / empty renders nothing', () => {
    expect(renderBlock(EPISODE_SUMMARIES_V2, { summaries: [], now: FIXED_NOW, timezone: null })).toBe('');
  });

  it('block.post_tool_nudge', () => {
    expect(renderBlock(POST_TOOL_NUDGE_V1, {})).toMatchSnapshot();
  });
});
