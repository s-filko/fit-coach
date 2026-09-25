import type { ConversationPhase } from '@domain/conversation/ports';

import { PHASE_PROMPTS, promptVersionsForPhase, STANDALONE_PROMPTS } from '..';

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

  it('promptVersionsForPhase(training) lists the phase (v5 — BUG-037 transition reply order; v4 was BUG-032 current-time directive; v3 was exerciseId / search_exercises tool rules; v2 was P4 Task 2, D-B), its directives and the shared blocks', () => {
    const versions = promptVersionsForPhase('training');
    expect(versions['phase.training']).toBe('v5');
    expect(versions['directive.identity']).toBeUndefined(); // training has no identity directive
    expect(versions['directive.tool-reply']).toBe('v1');
    expect(versions['block.episode_summaries']).toBe('v2');
    // BUG-036 + owner language rule (R3): training reaches DIRECTIVES_WITHOUT_IDENTITY_V2,
    // which carries LANGUAGE_V2 (no "from Telegram" wording) — the only v2 directive.
    expect(versions['directive.language']).toBe('v2');
    const {
      'phase.training': _phaseVersion,
      'block.episode_summaries': _episodeSummariesVersion,
      'directive.language': _languageVersion,
      ...rest
    } = versions;
    expect(Object.values(rest).every(v => v === 'v1')).toBe(true);
  });

  it('promptVersionsForPhase stamps the SAME blocks for every phase (one chat — P4 Task 5)', () => {
    for (const phase of Object.keys(PHASE_PROMPTS) as ConversationPhase[]) {
      const keys = Object.keys(promptVersionsForPhase(phase)).filter(k => k.startsWith('block.'));
      expect(keys.sort()).toEqual(['block.episode_summaries', 'block.post_tool_nudge']);
    }
  });

  it('promptVersionsForPhase stamps the phase module plus the shared blocks for every phase', () => {
    for (const phase of Object.keys(PHASE_PROMPTS) as ConversationPhase[]) {
      const versions = promptVersionsForPhase(phase);
      expect(versions[PHASE_PROMPTS[phase].current.id]).toBeDefined();
      expect(versions['block.episode_summaries']).toBe('v2');
      expect(versions['block.post_tool_nudge']).toBe('v1');
    }
  });

  it('every module id in the registry is unique', () => {
    const ids = [...Object.values(PHASE_PROMPTS).map(p => p.current.id), ...STANDALONE_PROMPTS.map(m => m.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
