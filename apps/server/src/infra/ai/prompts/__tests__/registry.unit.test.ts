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

  it('promptVersionsForPhase(registration) has no blocks', () => {
    expect(Object.keys(promptVersionsForPhase('registration')).some(k => k.startsWith('block.'))).toBe(false);
  });

  it('blocksForLayout reproduces the five pre-assembler blocks arrays verbatim', () => {
    // Written literally from the pre-Task-4 registry (the single source of
    // truth for what each phase injects, now derived from the layout).
    const expected: Record<ConversationPhase, readonly string[]> = {
      registration: [],
      chat: ['block.summary_frame'],
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
