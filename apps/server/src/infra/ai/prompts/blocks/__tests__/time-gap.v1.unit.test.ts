/**
 * The time-gap note (chat-continuity plan Task 2, AC-CC-2 / BUG-018): the
 * wording the journey scenarios assert verbatim — "The user returns after
 * 14 h" (journey A) and "The user returns after 3.5 h" (journey C) — plus
 * the one-decimal-only-when-non-integer hour formatting.
 */
import { renderBlock } from '@infra/ai/prompts/blocks';

import { TIME_GAP_V1 } from '../time-gap.v1';

const HOUR = 3_600_000;

describe('TIME_GAP_V1 (AC-CC-2 — the note before the new message after a pause)', () => {
  it('renders the journey-A marker verbatim for a 14 h gap', () => {
    const text = renderBlock(TIME_GAP_V1, { gapMs: 14 * HOUR });
    expect(text).toContain('The user returns after 14 h.');
  });

  it('renders the journey-C marker verbatim for a 3.5 h gap', () => {
    const text = renderBlock(TIME_GAP_V1, { gapMs: 3.5 * HOUR });
    expect(text).toContain('The user returns after 3.5 h.');
  });

  it('one decimal only when non-integer: 6 h 5 m renders as 6.1 h', () => {
    const text = renderBlock(TIME_GAP_V1, { gapMs: (6 * 60 + 5) * 60_000 });
    expect(text).toContain('The user returns after 6.1 h.');
  });

  it('tells the model to answer the new message first — the earlier conversation is context', () => {
    const text = renderBlock(TIME_GAP_V1, { gapMs: 14 * HOUR });
    expect(text).toMatch(/Reply to their new message first/i);
    expect(text).toMatch(/context, not an agenda/i);
  });
});
