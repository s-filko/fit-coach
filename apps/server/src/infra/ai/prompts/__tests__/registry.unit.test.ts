import { PHASE_PROMPTS, STANDALONE_PROMPTS, promptVersionsForPhase } from '..';

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

  it('every module id in the registry is unique', () => {
    const ids = [...Object.values(PHASE_PROMPTS).map(p => p.entry.current.id), ...STANDALONE_PROMPTS.map(m => m.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
