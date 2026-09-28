/**
 * The fact verifier call (fact-verification plan Task 2, AC-FV-1..4 wiring —
 * D2/D4/D5/D6): one structured call with the summarizer profile and the
 * fact_verdicts_v1 schema name, the D3 prompt (same transcript, numbered ops,
 * old fact text for update, reason for retract), verdicts mapped by index —
 * missing / duplicate / out-of-range index = unsupported — and the fail-closed
 * null on a thrown or unparsable answer.
 */
import type { LlmGateway } from '@domain/ai/ports';

import { FACT_VERDICTS_SCHEMA_NAME, verifyFactOperations } from '../verify-fact-operations';

import type { UserFact } from '@domain/user/ports';

const KNOWN_FACT_ID = '6e14cfe2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function knownFact(): UserFact {
  return {
    id: KNOWN_FACT_ID,
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
  };
}

function makeGateway(
  answer: unknown = { verdicts: [] },
  reject = false,
): { gateway: LlmGateway; structured: jest.Mock } {
  const structured = reject
    ? jest.fn().mockRejectedValue(new Error('provider down'))
    : jest.fn().mockResolvedValue(answer);
  return { gateway: { chat: jest.fn(), structured } as unknown as LlmGateway, structured };
}

const OPS = [
  {
    op: 'add' as const,
    category: 'physical_constraint' as const,
    fact: 'Knee pain for 5 days',
    durability: 'long_term' as const,
    evidence: 'колено болит уже пять дней',
  },
  {
    op: 'update' as const,
    factId: KNOWN_FACT_ID,
    category: 'equipment' as const,
    fact: 'On the leg press the platform weight adds to the plates',
    durability: 'long_term' as const,
    phaseNote: 'the coach estimates ~70%',
    evidence: 'почему рычажный',
  },
  {
    op: 'retract' as const,
    factId: KNOWN_FACT_ID,
    reason: 'the user said the shoulder is fine now',
    evidence: 'плечо здорово',
  },
];

const PARAMS = {
  transcript: 'User: колено болит уже пять дней\nAssistant: Понял.',
  operations: OPS,
  knownFacts: [knownFact()],
  runId: 'run-2',
  userId: 'u1',
};

describe('verifyFactOperations (fact-verification Task 2, D2-D6)', () => {
  it('D6: one structured call — summarizer profile, fact_verdicts_v1 schema name, run and user ids', async () => {
    const { gateway, structured } = makeGateway({
      verdicts: OPS.map((_, i) => ({ index: i, supported: true, reason: 'stub' })),
    });

    await verifyFactOperations({ llmGateway: gateway, ...PARAMS });

    expect(structured).toHaveBeenCalledTimes(1);
    const [schema, messages, opts] = structured.mock.calls[0] as unknown as [
      unknown,
      Array<{ role: string; content: string }>,
      Record<string, string>,
    ];
    expect(opts).toMatchObject({
      profile: 'summarizer',
      schemaName: FACT_VERDICTS_SCHEMA_NAME,
      runId: 'run-2',
      userId: 'u1',
    });
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    void schema;
  });

  it('D3: the prompt carries the transcript, the numbered ops, the old fact text and the retract reason', async () => {
    const { gateway, structured } = makeGateway({
      verdicts: [{ index: 0, supported: true, reason: 'stub' }],
    });

    await verifyFactOperations({ llmGateway: gateway, ...PARAMS });

    const prompt = (structured.mock.calls[0] as unknown as [unknown, Array<{ role: string; content: string }>])[1]
      .map(m => m.content)
      .join('\n');
    expect(prompt).toContain('User: колено болит уже пять дней');
    expect(prompt).toContain('[0] add');
    expect(prompt).toContain('fact: "Knee pain for 5 days"');
    expect(prompt).toContain('колено болит уже пять дней');
    expect(prompt).toContain('[1] update');
    expect(prompt).toContain('replaces the known fact: "For plate-loaded lever machines');
    expect(prompt).toContain('phase note: "the coach estimates ~70%"');
    expect(prompt).toContain('[2] retract');
    expect(prompt).toContain('reason: "the user said the shoulder is fine now"');
  });

  it('D4: verdicts map by index — supported and unsupported alike', async () => {
    const { gateway } = makeGateway({
      verdicts: [
        { index: 0, supported: true, reason: 'the user said five days' },
        { index: 1, supported: false, reason: 'the ~70% is the assistant’s figure' },
      ],
    });

    const verdicts = await verifyFactOperations({ llmGateway: gateway, ...PARAMS });

    expect(verdicts?.get(0)).toEqual({ supported: true, reason: 'the user said five days' });
    expect(verdicts?.get(1)).toEqual({ supported: false, reason: 'the ~70% is the assistant’s figure' });
    expect(verdicts?.has(2)).toBe(false); // no verdict for index 2 — unsupported by absence
  });

  it('D4: a duplicate index voids the operation — it counts as unsupported', async () => {
    const { gateway } = makeGateway({
      verdicts: [
        { index: 0, supported: true, reason: 'first' },
        { index: 0, supported: true, reason: 'duplicate' },
      ],
    });

    const verdicts = await verifyFactOperations({ llmGateway: gateway, ...PARAMS });

    expect(verdicts?.has(0)).toBe(false);
  });

  it('D4: an out-of-range index is dropped, not thrown', async () => {
    const { gateway } = makeGateway({
      verdicts: [
        { index: 0, supported: true, reason: 'ok' },
        { index: 99, supported: true, reason: 'hallucinated' },
      ],
    });

    const verdicts = await verifyFactOperations({ llmGateway: gateway, ...PARAMS });

    expect(verdicts?.get(0)).toEqual({ supported: true, reason: 'ok' });
    expect(verdicts?.has(99)).toBe(false);
  });

  it('D5: a thrown call returns null — the fail-closed signal', async () => {
    const { gateway } = makeGateway(undefined, true);

    await expect(verifyFactOperations({ llmGateway: gateway, ...PARAMS })).resolves.toBeNull();
  });

  it('D4: a partial answer maps — the operations it never mentioned read as unsupported by absence', async () => {
    const { gateway } = makeGateway({ verdicts: [{ index: 0, supported: true, reason: 'only one answered' }] });

    const verdicts = await verifyFactOperations({ llmGateway: gateway, ...PARAMS });

    expect(verdicts?.has(1)).toBe(false);
    expect(verdicts?.has(2)).toBe(false);
  });
});
