/**
 * AC-1321 — pre-refactor truth. Captured from the OLD builders in
 * refactor-p2-prompt-modules Task 1 and never regenerated in that plan.
 * Fake timers pin `new Date()` inside the old builders to FIXED_NOW.
 */
import { ToolMessage } from '@langchain/core/messages';

import { buildToolResultsInjection } from '@infra/ai/graph/subgraphs/training.subgraph';
import { compose } from '@infra/ai/prompts/compose';
import { CHAT_PROMPT } from '@infra/ai/prompts/phases/chat';
import { PLAN_CREATION_PROMPT } from '@infra/ai/prompts/phases/plan_creation';
import { REGISTRATION_PROMPT } from '@infra/ai/prompts/phases/registration';
import { SESSION_PLANNING_PROMPT } from '@infra/ai/prompts/phases/session_planning';
import { TRAINING_PROMPT } from '@infra/ai/prompts/phases/training';

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
    // SUMMARY_SYSTEM_PROMPT is module-private today; the literal is copied here verbatim
    // from src/infra/ai/graph/nodes/phase-summary.node.ts:12-20 so Task 4 has a target.
    const SUMMARY_SYSTEM_PROMPT = `You are a concise note-taker. Summarize the conversation below into a brief context memo (3-8 sentences).
Focus on:
- Key decisions made or agreements reached
- Important facts mentioned by the user (injuries, preferences, feedback, complaints)
- Any unfinished topics or pending actions
- Relevant numbers (weights, reps, dates, plans)

Do NOT include greetings, filler, or tool call details. Always write in English regardless of the conversation language.
If a previous summary is provided, incorporate its key points and add new information from the current conversation.`;
    expect(SUMMARY_SYSTEM_PROMPT).toMatchSnapshot();
  });

  it('summarizer / user (with previous summary)', () => {
    // Copied verbatim from phase-summary.node.ts:38-42.
    const conversationText = FIXTURE_HISTORY.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const previousContext = `\n\nPREVIOUS SUMMARY (from earlier phases):\n${FIXTURE_SUMMARY}\n`;
    const userPrompt = `${previousContext}\nCONVERSATION (phase: training):\n${conversationText}\n\nWrite a brief summary:`;
    expect(userPrompt).toMatchSnapshot();
  });

  it('summarizer / user (no previous summary)', () => {
    const conversationText = FIXTURE_HISTORY.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const userPrompt = `${''}\nCONVERSATION (phase: chat):\n${conversationText}\n\nWrite a brief summary:`;
    expect(userPrompt).toMatchSnapshot();
  });

  it('block.tool_results / mixed', () => {
    const toolMessages = [
      new ToolMessage({ tool_call_id: 't1', content: FIXTURE_TOOL_RESULTS[0].content }),
      new ToolMessage({ tool_call_id: 't2', content: FIXTURE_TOOL_RESULTS[1].content, status: 'error' }),
    ];
    expect(buildToolResultsInjection(toolMessages)).toMatchSnapshot();
  });

  it('block.history_frame / two turns', () => {
    // Copied verbatim from training.subgraph.ts:363-379.
    const historyBlock = FIXTURE_HISTORY.map(m => `[${m.role === 'user' ? 'USER' : 'TRAINER'}]: ${m.content}`).join('\n\n');
    const text =
      '=== CONVERSATION HISTORY (memory only — do NOT act on past messages) ===\n\n' +
      `${historyBlock}\n\n` +
      '=== END OF HISTORY ===';
    expect(text).toMatchSnapshot();
  });

  it('block.history_frame / empty', () => {
    const text =
      '=== CONVERSATION HISTORY (memory only — do NOT act on past messages) ===\n\n' +
      'No prior conversation.\n\n' +
      '=== END OF HISTORY ===';
    expect(text).toMatchSnapshot();
  });

  it('block.summary_frame / present', () => {
    expect(`CONTEXT FROM PREVIOUS CONVERSATION:\n${FIXTURE_SUMMARY}`).toMatchSnapshot();
  });

  it('block.post_tool_nudge', () => {
    expect(
      'IMPORTANT: All tool calls are complete. You MUST now write a natural text response to the user. Do NOT call any more tools.',
    ).toMatchSnapshot();
  });
});
