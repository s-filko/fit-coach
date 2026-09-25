import { compose } from '@infra/ai/prompts/compose';
import { PHASE_PROMPTS } from '@infra/ai/prompts/index';

/**
 * v5 (BUG-037, session-investigation-0925 R4): on a transition triggered by the user's
 * own set of the next exercise, the reply answers that set first; the finished exercise's
 * recap is brief and last; announcing the next exercise belongs only to the explicit
 * complete_current_exercise branch. Promoted from exercise-transition-order.repro.test.ts.
 */

/** The current training prompt, resolved through the prompt registry (never by importing vN directly). */
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

describe('phase.training v5 — exercise-transition reply order (BUG-037)', () => {
  it('answers the reported set BEFORE the recap of the finished exercise', () => {
    const block = transitionBlock(trainingPromptText());
    const confirmIdx = /(confirm|acknowledge|reply to|respond to)[^.\n]{0,140}\bset\b/i.exec(block)?.index ?? -1;
    const recapIdx = /recap[^.\n]{0,140}\b(finished|completed|previous|prior)\b/i.exec(block)?.index ?? -1;
    expect(recapIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeLessThan(recapIdx);
  });

  it('marks the finished-exercise recap brief (it is a side note, not the answer)', () => {
    const block = transitionBlock(trainingPromptText());
    const m = /recap[^.\n]{0,140}\b(finished|completed|previous|prior)\b/i.exec(block);
    expect(m).not.toBeNull();
    expect(block.slice(Math.max(0, m!.index - 200), m!.index + 200)).toMatch(
      /\b(brief|short|concise|one[- ]sentence|couple of (lines|sentences))\b/i,
    );
  });

  it('scopes "announce the next exercise" to transitions the user explicitly asked for — not to a set-triggered one', () => {
    const block = transitionBlock(trainingPromptText());
    const sentences = block.split(/\n+/).flatMap(line => line.split(/(?<=\.)\s+/));
    const announcing = sentences.filter(s => /announce[^.\n]{0,80}next exercise/i.test(s));
    // Any sentence that keeps the announcement must gate it on an explicit user request.
    expect(announcing.length).toBeGreaterThan(0); // the explicit complete_current_exercise branch keeps it
    for (const sentence of announcing) {
      expect(sentence).toMatch(/\b(explicit\w*|asked|asks|request\w*|said|says|told)\b/i);
    }
  });
});
