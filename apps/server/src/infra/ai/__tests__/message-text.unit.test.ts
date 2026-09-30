import { textOf, textOnly } from '@infra/ai/message-text';

describe('textOnly / textOf — the one text-of-content home (AC-PC-9 review R2)', () => {
  it('AC-PC-9: a string is returned as is', () => {
    expect(textOnly('hello')).toBe('hello');
    expect(textOf('hello')).toBe('hello');
  });

  it('AC-PC-9: a list of text parts joins to its text, ignoring cache_control and other keys on a part', () => {
    const parts = [
      { type: 'text', text: 'stable ', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'system' },
    ];
    expect(textOnly(parts)).toBe('stable system');
    expect(textOnly([])).toBe('');
  });

  it('AC-PC-9: any non-text part (or non-content value) → null, so a caller falls back to a structural form', () => {
    expect(
      textOnly([
        { type: 'text', text: 'a' },
        { type: 'image_url', image_url: { url: 'x' } },
      ]),
    ).toBeNull();
    expect(textOnly([{ text: 'no type' }])).toBeNull();
    expect(textOnly([null])).toBeNull();
    expect(textOnly(undefined)).toBeNull();
    expect(textOnly({ type: 'text', text: 'not a list' })).toBeNull();
  });

  it('AC-PC-9: textOf keeps its lossy contract — non-text parts are dropped, unknown content is empty', () => {
    expect(textOf([{ type: 'text', text: 'a' }, { type: 'image_url' }])).toBe('a');
    expect(textOf(undefined)).toBe('');
  });
});
