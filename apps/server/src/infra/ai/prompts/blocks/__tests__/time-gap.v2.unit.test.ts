/**
 * The time-gap note v2 (load-plan Task 4, AC-LP-6): one "long time no see" mechanism — the message gap of v1 plus the
 * training-break tier and, once per break, the reason question. v1's wording is untouched.
 */
import { renderBlock, TIME_GAP_PREFIX, TIME_GAP_V1 } from '@infra/ai/prompts/blocks';

import { TIME_GAP_V2 } from '../time-gap.v2';

const HOUR = 3_600_000;

describe('AC-LP-6 · TIME_GAP_V2', () => {
  it('without a training break it is v1 byte for byte', () => {
    expect(renderBlock(TIME_GAP_V2, { gapMs: 14 * HOUR })).toBe(renderBlock(TIME_GAP_V1, { gapMs: 14 * HOUR }));
  });

  it('a message gap plus a training break names the tier and asks once', () => {
    const text = renderBlock(TIME_GAP_V2, {
      gapMs: 30 * HOUR,
      training: { tier: 'rebuild', days: 30, ask: true },
    });
    expect(text.startsWith('The user returns after 30 h.')).toBe(true);
    expect(text).toContain('Training: training break of 30 days since the last workout (tier rebuild, general norm).');
    expect(text).toContain('ask ONCE');
    expect(text).toContain('Do not ask again');
  });

  it('the question is left out once it was asked', () => {
    const text = renderBlock(TIME_GAP_V2, { gapMs: 30 * HOUR, training: { tier: 'rebuild', days: 30, ask: false } });
    expect(text).toContain('tier rebuild');
    expect(text).not.toContain('ask ONCE');
  });

  it('a training break alone (recent messages) still starts with the v1 prefix, so cache attribution labels it', () => {
    const text = renderBlock(TIME_GAP_V2, { gapMs: null, training: { tier: 'return', days: 15, ask: true } });
    expect(text.startsWith(TIME_GAP_PREFIX)).toBe(true);
    expect(text).toContain('a training break of 15 days');
    expect(text).toContain('ask ONCE');
    expect(text).not.toMatch(/ h\./);
  });

  it('is a new version of the same block id', () => {
    expect(TIME_GAP_V2.id).toBe(TIME_GAP_V1.id);
    expect(TIME_GAP_V2.version).toBe('v2');
  });
});
