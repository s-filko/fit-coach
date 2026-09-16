/**
 * AC-1321 — pre-refactor truth. Captured from the OLD builders in
 * refactor-p2-prompt-modules Task 1 and never regenerated in that plan.
 * Fake timers pin `new Date()` inside the old builders to FIXED_NOW.
 */
import { ToolMessage } from '@langchain/core/messages';

import { buildChatSystemPrompt } from '@infra/ai/graph/nodes/chat.node';
import { buildPlanCreationSystemPrompt } from '@infra/ai/graph/nodes/plan-creation.node';
import { buildRegistrationSystemPrompt } from '@infra/ai/graph/nodes/registration.node';
import { buildSessionPlanningSystemPrompt } from '@infra/ai/graph/nodes/session-planning.node';
import { buildTrainingSystemPrompt } from '@infra/ai/graph/nodes/training.node';
import { buildToolResultsInjection } from '@infra/ai/graph/subgraphs/training.subgraph';

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
      expect(buildRegistrationSystemPrompt(user)).toMatchSnapshot();
    });

    it(`phase.chat / ${name}`, () => {
      expect(buildChatSystemPrompt(user, fixture.hasActivePlan ?? false, [], LAST_MESSAGE_YESTERDAY)).toMatchSnapshot();
    });

    it(`phase.plan_creation / ${name}`, () => {
      expect(buildPlanCreationSystemPrompt(user)).toMatchSnapshot();
    });

    it(`phase.session_planning / ${name}`, () => {
      expect(buildSessionPlanningSystemPrompt(user, buildSessionPlanningContext(fixture, FIXED_NOW))).toMatchSnapshot();
    });

    it(`phase.training / ${name}`, () => {
      expect(buildTrainingSystemPrompt(user, buildFixtureSession(fixture, FIXED_NOW), null)).toMatchSnapshot();
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
