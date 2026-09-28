/**
 * The fact verifier (fact-verification plan Task 2, D2-D6 — BUG-040 follow-up):
 * the model-based replacement of the string `checkFactProvenance`. One
 * structured call per compaction — only when the summariser returned at least
 * one mutating operation — receives the SAME transcript the summariser saw
 * plus the numbered candidate operations, and says per operation whether the
 * USER stated or explicitly confirmed it (the D3 rule lives in
 * `prompts/fact-verifier/v1.ts`). The call goes through the existing
 * `llmGateway` with the `summarizer` profile, so it is logged/recorded like
 * every other call (D6, the audit trail).
 *
 * D4: a verdict maps to an operation by its index; an operation with NO
 * verdict, a DUPLICATE or an OUT-OF-RANGE index counts as unsupported (absent
 * from the returned map). D5: a thrown or unparsable answer returns null —
 * the node then fails closed (every mutating operation skipped); a lost fact
 * is restated later, a false one persists.
 */
import { z } from 'zod';

import type { LlmGateway } from '@domain/ai/ports';
import type { ChatMsg } from '@domain/ai/types';
import type { FactOperation } from '@domain/conversation/episode';
import type { UserFact } from '@domain/user/ports';

import { FACT_VERIFIER_V1, type FactVerifierOperation } from '@infra/ai/prompts/fact-verifier';

import { createLogger } from '@shared/logger';

const log = createLogger('fact-verifier');

/** D6: the schema name as presented to the model (gateway logs it). */
export const FACT_VERDICTS_SCHEMA_NAME = 'fact_verdicts_v1';

/** D4: the verifier's structured output — strict, one verdict per operation. */
export const FactVerdictsSchema = z
  .object({
    verdicts: z.array(
      z
        .object({
          index: z.number().int(),
          supported: z.boolean(),
          reason: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type FactVerdicts = z.infer<typeof FactVerdictsSchema>;

/** Per mutating operation (by its index in the batch): the verdict that applies, when one does. */
export type FactVerdictMap = Map<number, { supported: boolean; reason: string }>;

export interface VerifyFactOperationsParams {
  llmGateway: LlmGateway;
  /** compact's renderTranscript of the removed episode — the same one the summariser saw (D3). */
  transcript: string;
  /** The MUTATING operations only (add/update/retract), in application order; confirm never reaches this. */
  operations: FactOperation[];
  /** The known active facts — for `update`/`retract`, the known fact's text the verifier must also see (D3, D13). */
  knownFacts: UserFact[];
  runId: string;
  userId: string;
}

/**
 * Runs the one verifier call and maps the verdicts onto the operations.
 * Returns null on ANY failure (throw, unparsable answer) — D5's fail-closed
 * signal; the node treats every mutating operation of the compaction as
 * unsupported then. Duplicates void their index (D4), out-of-range indices
 * are dropped, a missing index simply never enters the map.
 */
export async function verifyFactOperations(params: VerifyFactOperationsParams): Promise<FactVerdictMap | null> {
  const { llmGateway, transcript, operations, knownFacts, runId, userId } = params;
  const verifierOps: FactVerifierOperation[] = operations.map((op, index) => ({
    index,
    op: op.op as FactVerifierOperation['op'], // the caller passes mutating ops only (D2)
    fact: op.fact,
    phaseNote: op.phaseNote, // D12 legacy: its numbers are checked like the fact text's
    oldFactText: op.op === 'update' ? knownFacts.find(f => f.id === op.factId)?.fact : undefined,
    retractedFactText: op.op === 'retract' ? knownFacts.find(f => f.id === op.factId)?.fact : undefined,
    reason: op.op === 'retract' ? op.reason : undefined,
    evidence: op.evidence,
  }));

  const sections = FACT_VERIFIER_V1.render({ transcript, operations: verifierOps });
  const messages: ChatMsg[] = sections.map(s => ({
    role: s.id === 'system' ? 'system' : 'user',
    content: s.text,
  }));

  try {
    const answer = await llmGateway.structured(FactVerdictsSchema, messages, {
      profile: 'summarizer',
      schemaName: FACT_VERDICTS_SCHEMA_NAME,
      runId,
      userId,
    });
    const verdicts: FactVerdictMap = new Map();
    // A duplicated index is voided FOREVER (D4) — a later third verdict cannot resurrect it.
    const voided = new Set<number>();
    for (const v of answer.verdicts) {
      if (v.index < 0 || v.index >= operations.length) {
        continue; // out of range — cannot map to any operation (D4)
      }
      if (verdicts.has(v.index) || voided.has(v.index)) {
        verdicts.delete(v.index); // duplicate — the operation counts as unsupported (D4)
        voided.add(v.index);
        continue;
      }
      verdicts.set(v.index, { supported: v.supported, reason: v.reason });
    }
    return verdicts;
  } catch (err) {
    // D5: fail closed. Never log the fact text.
    log.warn(
      { err, userId, runId, operations: operations.length },
      'Fact verifier failed — every mutating operation of this compaction is skipped (fail closed)',
    );
    return null;
  }
}
