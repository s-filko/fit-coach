/**
 * Fact provenance (BUG-040, fact-provenance plan D4/D5/D6): the deterministic
 * guard between the summariser's answer and the episode's USER messages. A
 * mutating fact operation (add/update/retract) is applied only when the user
 * messages of the compacted episode support it — `evidence` quotes one of them
 * (D5) and every number in the fact text is user-stated (D4; for `update` a
 * number already in the old fact's text also counts). `confirm` is exempt
 * (D3) and never reaches this module. Pure (BR-LLM-007): texts arrive as
 * data; no clock, no I/O. The check never trusts the model's own claim of
 * provenance — it verifies the quote against the transcript.
 */

/** Why an operation was refused. Logged with the op and fact id — never the fact text. */
export type ProvenanceRejection =
  /** No evidence at all (D2: the field is optional so a missing one skips, never fails). */
  | 'missing_evidence'
  /** The evidence is empty after normalisation, too short, or quotes no user line. */
  | 'evidence_not_from_user'
  /** The fact text carries a number the user never stated (and, for update, not in the old fact either). */
  | 'number_not_user_stated';

export type ProvenanceVerdict = { ok: true } | { ok: false; reason: ProvenanceRejection };

export interface FactProvenanceInput {
  op: 'add' | 'update' | 'retract';
  /** D2: the verbatim quote the summariser returned for this operation. */
  evidence: string | undefined;
  /**
   * add/update: the fact text about to be stored — its numbers are checked
   * (D4). Malformed operations pass none; the node skips those anyway.
   */
  factText?: string;
  /** The episode's user messages (the human messages of `removed`). */
  userTexts: string[];
  /** update only: the text of the known fact being superseded — its numbers also count (D4). */
  oldFactText?: string;
}

/** Quote characters removed before comparison (D5) — the model may re-pair quotes. */
const QUOTE_CHARS = /["'«»“”„]/g;
/** Leading/trailing punctuation trimmed so «sentence.» matches «sentence». */
const EDGE_PUNCTUATION = /^[.,!?;:—–…]+\s*|\s*[.,!?;:—–…]+$/g;
/** D4's number shape: integer or decimal, comma or dot separator. */
const NUMBER = /\d+(?:[.,]\d+)?/g;

/** D5's one normalisation: lower case, ё→е, quotes out, whitespace collapsed, edge punctuation trimmed. */
export function normaliseForProvenance(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(QUOTE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(EDGE_PUNCTUATION, '')
    .trim();
}

/** Every number in the text as its canonical form (comma separator → dot). */
function numbersIn(text: string): Set<string> {
  return new Set((text.match(NUMBER) ?? []).map(n => n.replace(',', '.')));
}

/**
 * The minimum length of the normalised evidence (D5): below it a "quote" is
 * noise that could match anywhere, not a statement of a fact.
 */
const MIN_EVIDENCE_CHARS = 3;

export function checkFactProvenance(input: FactProvenanceInput): ProvenanceVerdict {
  const { evidence, factText, userTexts, oldFactText } = input;

  if (evidence === undefined || evidence.trim() === '') {
    return { ok: false, reason: 'missing_evidence' };
  }

  // D5: the normalised quote must be a substring of one normalised user
  // message — an Assistant line, a translation or a paraphrase never matches.
  const quote = normaliseForProvenance(evidence);
  const userLines = userTexts.map(normaliseForProvenance);
  if (quote.length < MIN_EVIDENCE_CHARS || !userLines.some(line => line.includes(quote))) {
    return { ok: false, reason: 'evidence_not_from_user' };
  }

  // D4: every number in the fact text must appear as a number the user wrote
  // (or, for update, that the old fact already carried). Losing a fact is
  // recoverable — it gets restated; storing a false one is not (BUG-040).
  if (factText !== undefined && factText !== '') {
    const established = new Set<string>();
    for (const line of userLines) {
      for (const n of numbersIn(line)) {
        established.add(n);
      }
    }
    if (oldFactText !== undefined) {
      for (const n of numbersIn(normaliseForProvenance(oldFactText))) {
        established.add(n);
      }
    }
    for (const n of numbersIn(factText)) {
      if (!established.has(n)) {
        return { ok: false, reason: 'number_not_user_stated' };
      }
    }
  }

  return { ok: true };
}
