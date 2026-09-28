/**
 * Episode summariser v5 (BUG-040, fact-provenance Task 2, AC-FP-5): v4's
 * operations plus PROVENANCE — the prompt asks for `evidence` on
 * add/update/retract and states that the assistant's own statements are never
 * user facts. Pure: transcript and known facts arrive as data; no clock, no
 * I/O. The deterministic half (checkFactProvenance, fact-provenance.ts) was
 * replaced by the model verifier (prompts/fact-verifier/v1.ts) in the
 * fact-verification plan — nothing enforces v5's evidence in code anymore.
 */
import type { UserFact } from '@domain/user/ports';

import { renderBlock } from '@infra/ai/prompts/blocks';
import { SUMMARIZER_V5 } from '../v5';

function fact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: 'u1',
    category: 'physical_constraint',
    fact: 'Cannot overhead press, shoulder injury',
    factKey: 'cannot overhead press, shoulder injury',
    muscleGroup: 'shoulders_front',
    confirmations: 3,
    sourceTurnId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-15T00:00:00Z'),
    durability: 'permanent',
    expiresAt: null,
    reviewAfter: null,
    phaseNote: null,
    phaseAt: null,
    onExpiry: null,
    status: 'active',
    archivedAt: null,
    archivedReason: null,
    closedByUserAt: null,
    supersedesId: null,
    context: null,
    ...overrides,
  };
}

describe('SUMMARIZER_V5 (AC-FP-5)', () => {
  it('renders the five summary fields and the operations contract', () => {
    const text = renderBlock(SUMMARIZER_V5, { phase: 'chat', transcript: 'User: hi', knownFacts: [] });
    for (const field of ['topics', 'decisions', 'userState', 'trainingFeedback', 'openItems']) {
      expect(text).toContain(field);
    }
    expect(text).toContain('fact_operations');
    for (const op of ['add', 'confirm', 'update', 'retract']) {
      expect(text).toContain(op);
    }
  });

  it('renders the KNOWN active facts with their ids — the model must reference them verbatim', () => {
    const text = renderBlock(SUMMARIZER_V5, {
      phase: 'chat',
      transcript: 'User: hi',
      knownFacts: [
        fact(),
        fact({
          id: '5b0f8a3e-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          category: 'equipment',
          fact: 'Trains at home',
          muscleGroup: null,
        }),
      ],
    });
    expect(text).toContain('5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(text).toContain('Cannot overhead press, shoulder injury');
    expect(text).toContain('physical_constraint');
    expect(text).toContain('permanent');
    expect(text).toContain('3× confirmed');
    expect(text).toContain('5b0f8a3e-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('AC-FP-5: asks for evidence on add/update/retract and exempts confirm', () => {
    const text = renderBlock(SUMMARIZER_V5, { phase: 'chat', transcript: 'User: hi', knownFacts: [fact()] });
    expect(text).toContain('evidence');
    expect(text).toMatch(/"confirm" needs no evidence/);
  });

  it('AC-FP-5: states that the assistant’s own statements are never user facts', () => {
    const text = renderBlock(SUMMARIZER_V5, { phase: 'chat', transcript: 'User: hi', knownFacts: [] });
    expect(text).toMatch(/assistant's own claims[^]*are NEVER user facts/i);
    expect(text).toMatch(/never from an Assistant line/);
    expect(text).toMatch(/only if the user themselves wrote that number/);
  });

  it('AC-FP-5 (D13): evidence is one continuous span of the user’s own words — no prefix, no elisions, no stitched fragments', () => {
    const text = renderBlock(SUMMARIZER_V5, { phase: 'chat', transcript: 'User: hi', knownFacts: [] });
    expect(text).toContain('one continuous span of the USER’s own words');
    expect(text).toContain('No "User:" prefix');
    expect(text).toContain('no ellipsis or … elisions');
    expect(text).toContain('no fragments stitched together');
  });

  it('AC-FP-5 (D13): the numbers rule covers fact AND phaseNote and is reconciled with "Include numbers"', () => {
    const text = renderBlock(SUMMARIZER_V5, { phase: 'chat', transcript: 'User: hi', knownFacts: [] });
    expect(text).toContain('in a fact or a phaseNote only if the user themselves wrote that number');
    // The general "Include numbers (weights, reps, dates)" sentence must point
    // at the PROVENANCE restriction instead of contradicting it.
    expect(text).toMatch(/Include numbers \(weights, reps, dates\)[^]*only if the user themselves wrote it/);
  });

  it('keeps the transcript as the user section, after the instructions', () => {
    const sections = SUMMARIZER_V5.render({ phase: 'training', transcript: 'User: did squats', knownFacts: [] });
    expect(sections.map(s => s.id)).toEqual(['system', 'user']);
    expect(sections[1].text).toContain('User: did squats');
    expect(sections[1].text).toContain('training');
  });

  it('is pure: the same input renders byte-identically, with no clock reads', () => {
    const ctx = { phase: 'chat' as const, transcript: 'User: hi', knownFacts: [fact()] };
    expect(renderBlock(SUMMARIZER_V5, ctx)).toBe(renderBlock(SUMMARIZER_V5, ctx));
  });
});
