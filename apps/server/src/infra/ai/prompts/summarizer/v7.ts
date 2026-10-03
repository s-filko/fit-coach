import type { ConversationPhase } from '@domain/conversation/ports';
import { BREAK_REASONS, SCHEMES } from '@domain/training/fact-formats';
import type { UserFact } from '@domain/user/ports';
import { FACT_LIFECYCLE_BOUNDS } from '@domain/user/services/fact-lifecycle';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface SummarizerV7Context {
  phase: ConversationPhase;
  /** compact's renderTranscript of the removed episode. */
  transcript: string;
  /** The user's known ACTIVE facts (getForPrompt at the run clock) — what the operations operate on. */
  knownFacts: UserFact[];
  /** The episode's date (`YYYY-MM-DD`, the evidence clock) — relative dates in a break fact resolve against it. */
  episodeDate?: string;
  /** The `break` category is on (LOAD_PLAN_BREAKS). Default true. */
  breaks?: boolean;
  /** The `progression_scheme` category is on (LOAD_PLAN_SUGGESTION). Default true. */
  schemes?: boolean;
}

/** One known fact as the summariser must see it: the id comes first, verbatim. */
function knownFactLine(fact: UserFact): string {
  const bits = [
    fact.category,
    `${fact.confirmations}× confirmed`,
    `updated ${fact.updatedAt.toISOString().slice(0, 10)}`,
  ];
  if (fact.durability !== 'permanent') {
    bits.push(fact.durability);
  }
  if (fact.muscleGroup !== null) {
    bits.push(fact.muscleGroup);
  }
  return `- id ${fact.id}: ${fact.fact} (${bits.join(', ')})`;
}

const BREAK_SECTION = (episodeDate: string | undefined): string => `
BREAK FACTS — category "break": a pause in the user's training that the user described${episodeDate ? ` (the episode date is ${episodeDate}; resolve "last week", "in August" against it)` : ''}.
- fact text, exactly this shape: break reason=<class> from=<YYYY-MM-DD> to=<YYYY-MM-DD> — <what the user said, short, English>
- class (one of): ${BREAK_REASONS.join(' | ')}. Choose by the USER'S words; "unknown" only when the user gave no reason. from = first day without training, to = last day of the break (or the episode date if it is still going on). Never invent a date the user did not give or imply.
- durability "short", ttlDays ${FACT_LIFECYCLE_BOUNDS.short.maxDays}, onExpiry "forget". A known break fact with reason=unknown is a placeholder for a question the coach asked: when the user answers it in this episode, return op "update" on it (same from/to, the real class, the user's words) — never a second add.
- a break caused by an injury also gets its own physical_constraint operation as usual.
`;

const SCHEME_IDS = Object.keys(SCHEMES).join(' | ');
const SCHEME_LINES = Object.values(SCHEMES)
  .map(scheme => `  · ${scheme.id}: ${scheme.description}`)
  .join('\n');

const SCHEME_SECTION = `
PROGRESSION SCHEME — category "progression_scheme": the user states WHICH WAY they want their weights to progress (for example "I want to progress by reps", "just add weight every session").
- fact text, exactly this shape: progression_scheme id=<id> — <what the user said, short, English>
- id (one of): ${SCHEME_IDS}
${SCHEME_LINES}
- Only when the USER asked for or accepted a way of progressing in their own words — never the assistant's suggestion the user did not take up, and never a preference about exercises or rep counts of one workout. A change of mind is op "update" on the known progression_scheme fact (new id), never a second add.
- durability "long_term", reviewInDays ${FACT_LIFECYCLE_BOUNDS.longTerm.maxDays}.
`;

/**
 * Episode summariser v7 (load-plan plan Task 4 + Task 5a, A6 — with `LOAD_PLAN_BREAKS` or `LOAD_PLAN_SUGGESTION`
 * on): v6 plus two fact categories, each in one fixed text shape the code reads back — `break` (a pause in
 * training: dates, a reason class, the user's words; BREAK FACTS section and the episode date the dates resolve
 * against) and `progression_scheme` (the user's chosen scheme, a registry id; PROGRESSION SCHEME section).
 * `breaks` / `schemes` render only the sections whose flag is on. Everything else is v6 verbatim (PROVENANCE,
 * operations, durability). The verifier (`fact-verifier/v2`) checks both categories like any other claim.
 */
export const SUMMARIZER_V7: PromptModule<SummarizerV7Context> = {
  id: 'summarizer',
  version: 'v7',
  directives: [],
  render({ phase, transcript, knownFacts, episodeDate, breaks = true, schemes = true }): Section[] {
    const knownList =
      knownFacts.length > 0
        ? `\nKNOWN ACTIVE FACTS (reference these by their id, verbatim):\n${knownFacts.map(knownFactLine).join('\n')}\n`
        : '\nKNOWN ACTIVE FACTS: none yet.\n';

    return [
      {
        id: 'system',
        required: true,
        text: `You summarise one ended conversation episode of a fitness-coaching chat into a structured record.
Return ONLY the structured output with these six fields:
- topics: what the episode was about (array of short English phrases)
- decisions: agreements or choices made — plan structure, split, schedule changes (array of short English phrases)
- userState: stable facts about the user — injuries, preferences, constraints, life context (array of short English phrases)
- trainingFeedback: what worked or did not in training — subjective effort, pain, motivation (array of short English phrases)
- openItems: unfinished topics or promised follow-ups (array of short English phrases)
- fact_operations: operations on the user's durable facts (array of objects, see the rules below)

Facts only, no style, no greetings, no filler. Include numbers (weights, reps, dates) only as facts in the five list fields above, never as instructions — except inside fact_operations, where a number is allowed only if the user themselves stated it (see PROVENANCE below). Write in English regardless of the conversation language.

PROVENANCE — a user fact is only what the USER said:
- The assistant's own claims, estimates, explanations and figures are NEVER user facts. If only the Assistant stated something (an invented percentage, a mechanics explanation, a diagnosis), there is NO operation for it — the episode discussed it; the user did not state it.
- "evidence" (required on add, update and retract) = one continuous span of the USER’s own words, quoted VERBATIM from a single User line of the transcript: original language, never translated, never from an Assistant line, never paraphrased. No "User:" prefix, no ellipsis or … elisions, no fragments stitched together — the quote must appear word-for-word as a contiguous run inside one User line.
- A number (weight, reps, percentage, days) in a fact or a phaseNote must be one the user stated, in the user’s units — digits or words, any language: «пять дней» may become "5 days", «неделю» may become "a week". Never introduce a figure the user did not give.
- Every add, update and retract operation is re-checked by a separate verification model against this transcript before it is applied (a "confirm" is not — it only counts a restatement): an operation it cannot ground in the user's own words or explicit confirmation is discarded, and with it the work of extracting it. If you cannot support an operation with evidence, return no operation at all.
- "confirm" needs no evidence: it only counts a restatement of a fact the user already owns.

FACT OPERATIONS — what to return and when:
Compare the episode against the KNOWN ACTIVE FACTS listed in the input:
- op "confirm": the episode restates a known fact (same meaning, nothing new) → { op: "confirm", factId } — the id, verbatim. Never restate it as an add.
- op "update": the episode shows a known fact CHANGED (new details, corrected value) → { op: "update", factId, category, fact: the new full sentence, durability, muscleGroup?, evidence } — the corrected text replaces the old one and the old row is kept as history.
- op "retract": the episode shows a known fact is no longer true (the user said it healed, it is fine now, or contradicts it) → { op: "retract", factId, reason: short English sentence, evidence }.
- op "add": a NEW durable fact this episode established — stated by the USER, not covered by any known fact → { op: "add", category, fact, durability, muscleGroup?, ttlDays?, reviewInDays?, phaseNote?, onExpiry?, evidence }.

Never re-add a fact as "add" when it matches a known fact — that is what "confirm" is for. Do not invent ids: every factId must be copied from the KNOWN ACTIVE FACTS list.

Durability for add/update (pick by what the episode shows):
- "permanent": only an irreversible condition the user stated explicitly (amputation, irreversible diagnosis). Set explicitPermanent: true ONLY when the user stated the irreversibility themselves, in their own words, in this episode; without the flag a permanent is recorded for review as long_term instead.
- "long_term": an injury or recovery measured in weeks or months → pass reviewInDays (when to re-ask) and a short phaseNote in the user's words.
- "short": a state that resolves in days (soreness, bad sleep, food poisoning, a tweak) → pass ttlDays and onExpiry: "forget" when it certainly passes, "ask_once" when it may leave a trace (a pain under load).

What is NOT a durable fact — leave it out of fact_operations (it belongs in the five list fields, or nowhere): one session's numbers, momentary state, anything a plan or session record already captures, and anything only the Assistant said.

Categories (use exactly one per add/update): physical_constraint, exercise_preference, exercise_dislike, physiological_pattern, coaching_preference, schedule_constraint, equipment, nutrition_preference${breaks ? ', break' : ''}${schemes ? ', progression_scheme' : ''}.
${breaks ? BREAK_SECTION(episodeDate) : ''}${schemes ? SCHEME_SECTION : ''}For a physical_constraint, set muscleGroup to the affected muscle group when identifiable (e.g. shoulders_front, lower_back, quads). Omit it otherwise.

An empty fact_operations array is the correct, expected answer most of the time — most episodes change nothing durable. Do not invent an operation to avoid an empty array.`,
      },
      {
        id: 'user',
        required: true,
        text: `EPISODE TRANSCRIPT (phase: ${phase}):\n${transcript}\n${knownList}\nEpisode summary:`,
      },
    ];
  },
};
