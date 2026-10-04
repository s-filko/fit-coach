import { BREAK_REASONS, type SchemeId, SCHEMES } from '@domain/user/services/fact-formats';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

/** One candidate operation as the verifier must see it (D3): the index is the verdict's `index`. */
export interface FactVerifierOperation {
  /** The verdict must quote this number back as `index`. */
  index: number;
  op: 'add' | 'update' | 'retract';
  /** add/update: the fact text about to be stored. */
  fact?: string;
  /** add/update: the phase note about to be stored beside the fact. */
  phaseNote?: string;
  /** update only: the text of the known fact being superseded. */
  oldFactText?: string;
  /** retract only: the text of the known fact being retracted (D13 — the reason alone misleads on a wrong factId). */
  retractedFactText?: string;
  /** retract only: why the summariser says the fact stopped being true. */
  reason?: string;
  /** The summariser’s own `evidence` quote — a HINT, verified against the transcript, never trusted. */
  evidence?: string;
}

/** How the user describes each scheme; keyed by `SchemeId`, so a new scheme fails to compile until it has one. */
const SCHEME_WORDS: Record<SchemeId, string> = {
  double_progression: 'by reps inside a range',
  linear_progression: 'a fixed rep target with weight added each time',
};
const SCHEME_HINTS = Object.keys(SCHEMES)
  .map(id => `${SCHEME_WORDS[id as SchemeId]} = ${id}`)
  .join('; ');

export interface FactVerifierV2Context {
  /** compact's renderTranscript of the removed episode — the same transcript the summariser saw (D3). */
  transcript: string;
  /** The candidate operations, numbered. */
  operations: FactVerifierOperation[];
}

/**
 * Fact verifier v2 (the live version): the model-based replacement of the string `checkFactProvenance`
 * (fact-verification plan, BUG-040 follow-up) — one structured call receives the episode transcript with speaker
 * labels and the candidate operations, and says per operation whether the USER stated or explicitly confirmed it.
 * Only verdicts the code can map to an operation count (missing / duplicate / out-of-range index → unsupported, D4);
 * a thrown or unparsable answer fails closed in `verify-fact-operations` (D5). v2 = v1 (retired) plus the `break`
 * and `progression_scheme` category rules: a break fact (break reason=<class> from=<date> to=<date> — <words>) is
 * supported only when the user said that they paused training for that reason and over those dates, the reason
 * class the one the user's words name ("unknown" only when the user gave no reason); a scheme only when the user
 * asked for or accepted it. Pure (BR-LLM-007): transcript and operations arrive as data; no clock, no I/O.
 */
export const FACT_VERIFIER_V2: PromptModule<FactVerifierV2Context> = {
  id: 'fact-verifier',
  version: 'v2',
  directives: [],
  render({ transcript, operations }): Section[] {
    const opLines = operations
      .map(op => {
        const bits = [`[${op.index}] ${op.op}`];
        if (op.fact !== undefined) {
          bits.push(`fact: "${op.fact}"`);
        }
        if (op.oldFactText !== undefined) {
          bits.push(`replaces the known fact: "${op.oldFactText}"`);
        }
        if (op.retractedFactText !== undefined) {
          bits.push(`fact being retracted: "${op.retractedFactText}"`);
        }
        if (op.reason !== undefined) {
          bits.push(`reason: "${op.reason}"`);
        }
        if (op.phaseNote !== undefined) {
          bits.push(`phase note: "${op.phaseNote}"`);
        }
        if (op.evidence !== undefined) {
          bits.push(`summariser’s evidence hint: «${op.evidence}»`);
        }
        return bits.join(' — ');
      })
      .join('\n');

    return [
      {
        id: 'system',
        required: true,
        text: `You are the fact-verification layer of a fitness-coaching chat. You get the transcript of one ended conversation episode (User / Assistant / tool lines labelled) and numbered candidate fact operations the episode summariser extracted. For EACH operation decide one thing: did the USER state it, or explicitly confirm it?

The rule:
- An operation is supported ONLY if the user stated it themselves, or explicitly confirmed it — a direct "да" to the assistant’s question about exactly that thing counts. Anything only the assistant said, estimated, explained or suggested is UNSUPPORTED — even if the user asked about it, seemed interested, or thanked for it.
- Every number or amount in the fact text or the phase note (weights, reps, percentages, days) must match what the user actually said — digits or words, any language, same meaning: «пять дней» = "5 days", «неделю» = "a week" / "7 days". A figure the user never gave makes the operation unsupported.
- A "break" fact (text: break reason=<class> from=<YYYY-MM-DD> to=<YYYY-MM-DD> — <words>) is supported only if the USER said they stopped training and why: the reason class must be the one their words name (${BREAK_REASONS.filter(r => r !== 'unknown').join(', ')}), and "unknown" only when the user gave no reason. The dates must follow from what the user said (a period, "three weeks", "since August"); a date the user neither gave nor implied makes the operation unsupported. An update of a break placeholder with reason=unknown is supported when the user answers the coach's question about the pause.
- A "progression_scheme" fact (text: progression_scheme id=<id> — <words>) is supported only if the USER asked for, or explicitly accepted, that way of progressing their weights in their own words, and the id matches what they described (${SCHEME_HINTS}). A scheme the assistant merely suggested, or that the user did not take up, is unsupported.
- The user speaks any language; the fact text is in English. Judge by meaning, never by string matching.
- The summariser’s evidence hint is a suggestion, not proof: it may be wrong, paraphrased, or quote the Assistant. Verify against the transcript’s User lines yourself.

Return ONLY the structured output: verdicts, exactly one per operation, each { index, supported, reason, userQuote }. index = the operation’s [n] number, verbatim. reason = one short English sentence naming what in the transcript (or its absence) decided it. userQuote = the user’s own words from the transcript that support the operation — a short exact quote from one User line, in the original language, never translated, never the assistant’s words; empty when unsupported.`,
      },
      {
        id: 'user',
        required: true,
        text: `EPISODE TRANSCRIPT:\n${transcript}\n\nOPERATIONS TO VERIFY:\n${opLines}\n\nVerdicts:`,
      },
    ];
  },
};
