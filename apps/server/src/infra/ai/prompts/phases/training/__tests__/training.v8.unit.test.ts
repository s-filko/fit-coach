import { compose } from '@infra/ai/prompts/compose';
import { TRAINING_PROMPT_V10 } from '..';

/**
 * v8 place rule (set-kind plan D6, close-out review B2, AC-SK-7): the prompt must carry the
 * "record only when named, ask once only off the overview's ask line" rule, and neither the
 * TOOLS entry nor the tool's own description may say "never ask" unconditionally — the ask
 * line's one exception must survive in both places.
 */
function trainingPromptText(): string {
  const sections = TRAINING_PROMPT_V10.current.render({
    now: new Date('2026-09-29T08:00:00Z'),
    timezone: 'Europe/Berlin',
    client: 'telegram',
    user: null,
    lastMessageTime: null,
  });
  return compose(sections);
}

describe('phase.training v8 — session place rule (set-kind plan D6, AC-SK-7)', () => {
  it('states the place is recorded only when the user names it', () => {
    const prompt = trainingPromptText();
    expect(prompt).toMatch(/place/i);
    expect(prompt).toMatch(/user names it|user's own words|states the place/i);
  });

  it('states the coach asks once this session when WORKOUT OVERVIEW shows the ask line', () => {
    const prompt = trainingPromptText();
    expect(prompt).toMatch(/not stated \(ask/);
    expect(prompt).toMatch(/ask (the user )?(that one question |it )?once this session/i);
  });

  it('the set_session_place TOOLS entry does not say "never ask" unconditionally — it names the ask-line exception', () => {
    const prompt = trainingPromptText();
    const toolsIdx = prompt.indexOf('=== TOOLS ===');
    const rulesIdx = prompt.indexOf('CRITICAL RULES');
    expect(toolsIdx).toBeGreaterThan(-1);
    const toolsBlock = prompt.slice(toolsIdx, rulesIdx > -1 ? rulesIdx : undefined);
    const entryMatch = /set_session_place.*$/m.exec(toolsBlock);
    expect(entryMatch).not.toBeNull();
    const [entry] = entryMatch!;
    expect(entry).toMatch(/one exception/i);
    expect(entry).toMatch(/not stated \(ask/);
  });
});
