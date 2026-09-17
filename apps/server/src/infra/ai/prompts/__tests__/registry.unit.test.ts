import type { ConversationPhase } from '@domain/conversation/ports';

import { PHASE_PROMPTS, STANDALONE_PROMPTS, blocksForLayout, promptVersionsForPhase } from '..';

describe('prompt registry (ADR-0013 §5, BR-LLM-008 — one list, real promptVersions)', () => {
  it('has an entry for every conversation phase', () => {
    expect(Object.keys(PHASE_PROMPTS).sort()).toEqual([
      'chat',
      'plan_creation',
      'registration',
      'session_planning',
      'training',
    ]);
  });

  it('promptVersionsForPhase(training) lists the phase, its directives and its blocks, all v1', () => {
    const versions = promptVersionsForPhase('training');
    expect(versions['phase.training']).toBe('v1');
    expect(versions['directive.identity']).toBeUndefined(); // training has no identity directive
    expect(versions['directive.tool-reply']).toBe('v1');
    expect(versions['block.tool_results']).toBe('v1');
    expect(versions['block.history_frame']).toBe('v1');
    expect(Object.values(versions).every(v => v === 'v1')).toBe(true);
  });

  it('promptVersionsForPhase(registration) pins only the post-tool nudge block (reviewed change: the nudge now applies to every phase)', () => {
    const keys = Object.keys(promptVersionsForPhase('registration')).filter(k => k.startsWith('block.'));
    expect(keys).toEqual(['block.post_tool_nudge']);
    expect(promptVersionsForPhase('registration')['block.post_tool_nudge']).toBe('v1');
  });

  it('promptVersionsForPhase(chat) gains block.post_tool_nudge (reviewed change)', () => {
    const keys = Object.keys(promptVersionsForPhase('chat')).filter(k => k.startsWith('block.'));
    expect(keys).toEqual(['block.summary_frame', 'block.post_tool_nudge']);
  });

  it('blocksForLayout matches the registry layouts, with the nudge block on every phase', () => {
    // The layout-derived blocks per phase; blocksForLayout always appends the
    // post-tool nudge (ADR-0013 §6 — one agent node, nudge everywhere).
    const expected: Record<ConversationPhase, readonly string[]> = {
      registration: ['block.post_tool_nudge'],
      chat: ['block.summary_frame', 'block.post_tool_nudge'],
      plan_creation: ['block.summary_frame', 'block.post_tool_nudge'],
      session_planning: ['block.summary_frame', 'block.post_tool_nudge'],
      training: ['block.summary_frame', 'block.history_frame', 'block.tool_results', 'block.post_tool_nudge'],
    };
    for (const phase of Object.keys(PHASE_PROMPTS) as ConversationPhase[]) {
      expect(blocksForLayout(PHASE_PROMPTS[phase].layout).map(b => b.id)).toEqual(expected[phase]);
    }
  });

  it('every module id in the registry is unique', () => {
    const ids = [...Object.values(PHASE_PROMPTS).map(p => p.entry.current.id), ...STANDALONE_PROMPTS.map(m => m.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
