/**
 * Fact verifier v1 (fact-verification plan Task 2, AC-FV-5): the prompt
 * module states the D3 rule — user-stated or explicitly confirmed only,
 * coach-only claims unsupported, numbers may match in words in any language.
 * Pure: transcript and operations arrive as data; no clock, no I/O.
 */
import type { UserFact } from '@domain/user/ports';

import { renderBlock } from '@infra/ai/prompts/blocks';
import { FACT_VERIFIER_V1 } from '../v1';

function fact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: '6e14cfe2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: 'u1',
    category: 'equipment',
    fact: 'For plate-loaded lever machines, displayed plate weight excludes the machine own weight',
    factKey: 'for plate-loaded lever machines, displayed plate weight excludes the machine own weight',
    muscleGroup: null,
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
    evidence: null,
    ...overrides,
  };
}

describe('FACT_VERIFIER_V1 (AC-FV-5, D3)', () => {
  it('renders the transcript and the numbered operations — index, op, fact, hint', () => {
    const text = renderBlock(FACT_VERIFIER_V1, {
      transcript: 'User: колено болит уже пять дней\nAssistant: Понял.',
      operations: [{ index: 0, op: 'add', fact: 'Knee pain for 5 days', evidence: 'колено болит уже пять дней' }],
    });
    expect(text).toContain('User: колено болит уже пять дней');
    expect(text).toContain('[0] add');
    expect(text).toContain('fact: "Knee pain for 5 days"');
    expect(text).toContain('колено болит уже пять дней');
  });

  it('AC-FV-5: update renders the old fact text, retract the reason, add the phase note (D3)', () => {
    const text = renderBlock(FACT_VERIFIER_V1, {
      transcript: 'User: hi',
      operations: [
        {
          index: 0,
          op: 'update',
          fact: 'On the leg press the platform weight adds to the plates',
          oldFactText: fact().fact,
          phaseNote: 'the coach estimates ~70%',
          evidence: 'почему рычажный',
        },
        {
          index: 1,
          op: 'retract',
          retractedFactText: fact().fact,
          reason: 'the user said the shoulder is fine now',
          evidence: 'плечо здорово',
        },
      ],
    });
    expect(text).toContain('replaces the known fact: "For plate-loaded lever machines');
    expect(text).toContain('phase note: "the coach estimates ~70%"');
    expect(text).toContain('fact being retracted: "For plate-loaded lever machines');
    expect(text).toContain('reason: "the user said the shoulder is fine now"');
    expect(text).toContain('[1] retract');
  });

  it('AC-FV-5: states the D3 rule — user-stated or explicitly confirmed only; coach-only is unsupported', () => {
    const text = renderBlock(FACT_VERIFIER_V1, { transcript: 'User: hi', operations: [] });
    expect(text).toMatch(/supported ONLY if the user stated it themselves, or explicitly confirmed it/);
    expect(text).toMatch(/Anything only the assistant said[^]*is UNSUPPORTED/);
    expect(text).toMatch(/a direct "да" to the assistant’s question about exactly that thing counts/);
  });

  it('AC-FV-5: numbers may match in words, any language, same meaning — «пять дней» = "5 days"', () => {
    const text = renderBlock(FACT_VERIFIER_V1, { transcript: 'User: hi', operations: [] });
    expect(text).toContain('digits or words, any language, same meaning');
    expect(text).toContain('«пять дней» = "5 days"');
    expect(text).toContain('«неделю» = "a week" / "7 days"');
    expect(text).toMatch(/A figure the user never gave makes the operation unsupported/);
  });

  it('AC-FV-5: the evidence hint is marked a hint, never proof', () => {
    const text = renderBlock(FACT_VERIFIER_V1, { transcript: 'User: hi', operations: [] });
    expect(text).toContain('summariser’s evidence hint');
    expect(text).toMatch(/a suggestion, not proof/);
  });

  it('asks for exactly one verdict per operation, index verbatim', () => {
    const text = renderBlock(FACT_VERIFIER_V1, { transcript: 'User: hi', operations: [] });
    expect(text).toContain('exactly one per operation');
    expect(text).toContain('index = the operation’s [n] number, verbatim');
  });

  it('is pure: the same input renders byte-identically, with no clock reads', () => {
    const ctx = {
      transcript: 'User: hi\nAssistant: hello',
      operations: [{ index: 0, op: 'add' as const, fact: 'F', evidence: 'hi' }],
    };
    expect(renderBlock(FACT_VERIFIER_V1, ctx)).toBe(renderBlock(FACT_VERIFIER_V1, ctx));
  });

  // fact-verification plan Task 5 (D18): the verdict also returns the user's
  // own supporting words as `userQuote` — stored with the fact so the coach
  // can quote the user's real words instead of inventing a quote (BUG-040 item 4).
  it('Task 5 (D18): asks for userQuote — the user’s own words, exact, empty when unsupported', () => {
    const text = renderBlock(FACT_VERIFIER_V1, { transcript: 'User: hi', operations: [] });
    expect(text).toContain('userQuote');
    expect(text).toMatch(/the user’s own words/);
    expect(text).toMatch(/empty when unsupported/);
  });
});
