/**
 * REPRODUCTION (RED) — AC-SI-4 / F4. Runs only via an explicit --testMatch; promoted to
 * log-set.tool.unit.test.ts and the training prompt test when the fix lands.
 *
 * Owner rule (2026-09-25, plan session-investigation-0925): when the user reports a set of the
 * NEXT exercise, the reply must confirm THAT set first; the recap of the finished exercise comes
 * last and is brief; the model must not "announce the next exercise" — the user already started it.
 *
 * Two production surfaces prescribe the opposite order today:
 *  - the auto-complete text the model reads after a set-triggered transition
 *    (format-exercise-summary.ts:46 — "Summarize this exercise ... Then announce the next
 *    exercise from SESSION PLAN"), reached through log_set for a different exercise;
 *  - the current training prompt's transition rule 4a/4b (phases/training/v3.ts) — "a) SUMMARIZE
 *    the completed exercise ... b) THEN announce the next exercise".
 * Live evidence: runs 7853c472, 92351633, cca871bd, 7a29f509 (session e9e76f10); the recap
 * arrived one turn late, answered to «что?»/«??»/«.».
 *
 * Assertions are deliberately semantic: any wording that tells the model to answer the reported
 * set first, keep the recap short and place it last, and not announce an exercise the user
 * already started, passes. No exact-string matching on the current broken wording.
 */
import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { SessionSet } from '@domain/training/types';

import { PHASE_PROMPTS } from '@infra/ai/prompts';
import { compose } from '@infra/ai/prompts/compose';
import { toToolMessage } from '@infra/ai/tools/outcome';

import { makeDeps, makeTrainingService } from './log-set-test-support';

// ---------------------------------------------------------------------------
// Semantic cues — see header. Anything implementing the owner's rule matches.
// ---------------------------------------------------------------------------

/** "confirm / acknowledge / reply to / address … the (reported) set" — the answer-first rule. */
const CONFIRM_REPORTED_SET_RE =
  /(confirm|acknowledge|reply to|respond to|answer|address)[^.\n]{0,140}\b(set|sets|reported)\b/i;
/** "summarize / recap … the completed exercise" — the finished-exercise recap. */
const RECAP_COMPLETED_RE =
  /(summar(y|ize|ise)|recap|wrap[- ]?up)[^.\n]{0,140}\b(completed|finished|previous|prior|exercise|work)\b/i;
/** A brevity cue near the recap instruction. */
const BRIEF_RE = /\b(brief|short|concise|one[- ]sentence|couple of (lines|sentences))\b/i;
/** "announce … next exercise" — forbidden for a transition the user's own set triggered. */
const ANNOUNCE_NEXT_RE = /announce[^.\n]{0,80}next exercise/i;
/** A gate scoping an instruction to the user explicitly asking to move on. */
const EXPLICIT_MOVEON_RE = /\b(explicit\w*|asked|asks|request\w*|said|says|told)\b/i;

/** Renders a tool return exactly as the executor will (Task 5 contract). */
function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

/**
 * Drives the real log_set auto-complete path: the user reports a set for Lat Pulldown while
 * Lateral Raise is current — the service auto-completes Lateral Raise and the tool appends
 * formatExerciseSummary's instructions after the set confirmation.
 */
async function autoCompleteNotice(): Promise<string> {
  const trainingService = makeTrainingService();
  const mockSet: SessionSet = {
    id: 'set-1',
    sessionExerciseId: 'ex-1',
    setNumber: 1,
    rpe: null,
    userFeedback: null,
    createdAt: new Date(),
    completedAt: null,
    setData: { type: 'strength', reps: 10, weight: 50, weightUnit: 'kg' },
  };
  trainingService.logSetWithContext.mockResolvedValue({
    set: mockSet,
    setNumber: 1,
    autoCompleted: {
      exerciseId: '00000000-0000-4000-8000-00000000000a',
      exerciseName: 'Lateral Raise',
      setsLogged: 2,
      sets: [
        { setNumber: 1, reps: 15, weight: 10, weightUnit: 'kg', rpe: null },
        { setNumber: 2, reps: 12, weight: 10, weightUnit: 'kg', rpe: 8 },
      ],
      targetSets: 3,
      targetReps: '12-15',
      targetWeight: null,
    },
  });

  const { byName, config } = makeDeps(trainingService);
  const result = (await byName('log_set').invoke(
    { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', reps: 10, weight: 50 },
    config,
  )) as ToolReturn;
  return renderedContent(result);
}

/** The current training prompt, resolved through the prompt registry (never by importing v3). */
function trainingPromptText(): string {
  const sections = PHASE_PROMPTS.training.current.render({
    now: new Date('2026-09-25T08:00:00Z'),
    timezone: 'Europe/Berlin',
    client: 'telegram',
    user: null,
    lastMessageTime: null,
  });
  return compose(sections);
}

/** The exercise-transition instructions of the prompt; the whole prompt when the block moves. */
function transitionBlock(prompt: string): string {
  const m = /exercise transition/i.exec(prompt) ?? /transition/i.exec(prompt);
  if (!m) {
    return prompt;
  }
  const rest = prompt.slice(m.index + m[0].length);
  const next = /\n\d+\.\s/.exec(rest);
  return prompt.slice(m.index, next ? m.index + m[0].length + next.index : undefined);
}

describe('AC-SI-4 (F4) — set-triggered exercise transition: reply order — auto-complete tool text', () => {
  it('harness: a set-triggered switch really renders the completion notice after the set confirmation', async () => {
    const text = await autoCompleteNotice();
    // Guards so a red failure below is attributable to the TEXT, not to this harness.
    expect(text).toMatch(/Set 1 logged/);
    expect(text).toContain('Lateral Raise');
  });

  it('instructs the model to confirm the set the user just reported FIRST (currently it goes straight to the summary)', async () => {
    const text = await autoCompleteNotice();
    expect(CONFIRM_REPORTED_SET_RE.test(text)).toBe(true);
  });

  it('places the finished-exercise recap AFTER the set confirmation and marks it brief', async () => {
    const text = await autoCompleteNotice();
    const recapIdx = RECAP_COMPLETED_RE.exec(text)?.index ?? -1;
    const confirmIdx = CONFIRM_REPORTED_SET_RE.exec(text)?.index ?? -1;
    expect(recapIdx).toBeGreaterThan(-1);
    const window = text.slice(Math.max(0, recapIdx - 200), recapIdx + 200);
    expect(BRIEF_RE.test(window) || (confirmIdx > -1 && confirmIdx < recapIdx)).toBe(true);
  });

  it('does not tell the model to announce the next exercise — the user already started it', async () => {
    const text = await autoCompleteNotice();
    expect(text).not.toMatch(ANNOUNCE_NEXT_RE);
  });
});

describe('AC-SI-4 (F4) — set-triggered exercise transition: reply order — training prompt', () => {
  it('instructs the model to reply to the reported set BEFORE the recap of the finished exercise (currently 4a summarizes first)', () => {
    const block = transitionBlock(trainingPromptText());
    const confirmIdx = CONFIRM_REPORTED_SET_RE.exec(block)?.index ?? -1;
    const recapIdx = RECAP_COMPLETED_RE.exec(block)?.index ?? -1;
    expect(recapIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeLessThan(recapIdx);
  });

  it('marks the finished-exercise recap brief (it is a side note, not the answer)', () => {
    const block = transitionBlock(trainingPromptText());
    const m = RECAP_COMPLETED_RE.exec(block);
    expect(m).not.toBeNull();
    const window = block.slice(Math.max(0, m!.index - 200), m!.index + 200);
    expect(BRIEF_RE.test(window)).toBe(true);
  });

  it('scopes "announce the next exercise" to transitions the user asked for — not to a set-triggered one', () => {
    const block = transitionBlock(trainingPromptText());
    const sentences = block.split(/\n+/).flatMap(line => line.split(/(?<=\.)\s+/));
    const announcing = sentences.filter(s => ANNOUNCE_NEXT_RE.test(s));
    // Nothing to check when the wording drops the announcement entirely — that also satisfies
    // the owner's rule; any sentence that keeps it must gate it on an explicit user request.
    for (const sentence of announcing) {
      expect(sentence).toMatch(EXPLICIT_MOVEON_RE);
    }
  });
});
