/**
 * `chat.context` block == v1's `context` section, character for character, on
 * every L0 fixture (P4 context-budget plan, Task 2 — the byte-identity proof
 * this block moves text, never rewords it).
 */
import { sectionText } from '@infra/ai/prompts/compose';
import { CHAT_V1 } from '@infra/ai/prompts/phases/chat/v1';

import { ALL_FIXTURES } from '../../../../../../evals/fixtures/personas';
import { contextsForModule } from '../../../../../../evals/fixtures/prompt-contexts';
import { CHAT_CONTEXT_V1, type ChatContextData } from '../chat-context.v1';
import type { ContextBlockCtx } from '../types';

describe('CHAT_CONTEXT_V1 == phase.chat v1 section "context" (byte-identity)', () => {
  it.each(ALL_FIXTURES)('$name', ({ fixture }) => {
    const v1Ctx = contextsForModule('phase.chat', fixture) as Parameters<typeof CHAT_V1.render>[0];
    const expected = sectionText(CHAT_V1.render(v1Ctx), 'context');

    const blockCtx: ContextBlockCtx = { now: v1Ctx.now, timezone: v1Ctx.timezone, user: v1Ctx.user };
    const data: ChatContextData = { hasActivePlan: v1Ctx.hasActivePlan, recentSessions: v1Ctx.recentSessions };
    const actual = CHAT_CONTEXT_V1.render(data, blockCtx, 5);

    expect(actual).toBe(expected);
  });

  it('depth 5 is the block default (full depth)', () => {
    expect(CHAT_CONTEXT_V1.depths?.[0]).toBe(5);
  });

  it('depth steps down the recent-sessions list without throwing', () => {
    const ctx: ContextBlockCtx = { now: new Date('2026-09-13T10:00:00.000Z'), timezone: null, user: null };
    const data: ChatContextData = { hasActivePlan: false, recentSessions: [] };
    expect(CHAT_CONTEXT_V1.render(data, ctx, 3)).toContain('No recent sessions.');
    expect(CHAT_CONTEXT_V1.render(data, ctx, 1)).toContain('No recent sessions.');
  });
});
