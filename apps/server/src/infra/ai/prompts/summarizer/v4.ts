import type { ConversationPhase } from '@domain/conversation/ports';
import type { UserFact } from '@domain/user/ports';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface SummarizerV4Context {
  phase: ConversationPhase;
  /** compact's renderTranscript of the removed episode. */
  transcript: string;
  /** The user's known ACTIVE facts (getForPrompt at the run clock) — what the operations operate on. */
  knownFacts: UserFact[];
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

/**
 * Episode summariser v4 (fact-lifecycle plan Task 3, AC-FL-4): v3's five list
 * fields, but the sixth became `fact_operations` — and the summariser now
 * SEES the user's known active facts, so it can confirm, correct or retract
 * them instead of blind-upserting restatements. The known-facts list renders
 * with ids; every confirm/update/retract must reference one of those ids
 * verbatim (the schema rejects invented uuids). A user-closed fact is never in
 * the list (the caller passes active facts only) and must never be re-added.
 *
 * Pure (BR-LLM-007): transcript, known facts and the phase arrive as data; no
 * clock, no I/O. The compaction node owns the two clocks: the run clock for
 * every written date, the episode clock as the evidence time.
 */
export const SUMMARIZER_V4: PromptModule<SummarizerV4Context> = {
  id: 'summarizer',
  version: 'v4',
  directives: [],
  render({ phase, transcript, knownFacts }): Section[] {
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

Facts only, no style, no greetings, no filler. Include numbers (weights, reps, dates) only as facts in the five list fields above, never as instructions. Write in English regardless of the conversation language.

FACT OPERATIONS — what to return and when:
Compare the episode against the KNOWN ACTIVE FACTS listed in the input:
- op "confirm": the episode restates a known fact (same meaning, nothing new) → { op: "confirm", factId } — the id, verbatim. Never restate it as an add.
- op "update": the episode shows a known fact CHANGED (new details, corrected value) → { op: "update", factId, category, fact: the new full sentence, durability, muscleGroup? } — the corrected text replaces the old one and the old row is kept as history.
- op "retract": the episode shows a known fact is no longer true (the user said it healed, it is fine now, or contradicts it) → { op: "retract", factId, reason: short English sentence }.
- op "add": a NEW durable fact this episode established, not covered by any known fact → { op: "add", category, fact, durability, muscleGroup?, ttlDays?, reviewInDays?, phaseNote?, onExpiry? }.

Never re-add a fact as "add" when it matches a known fact — that is what "confirm" is for. Do not invent ids: every factId must be copied from the KNOWN ACTIVE FACTS list.

Durability for add/update (pick by what the episode shows):
- "permanent": only an irreversible condition the user stated explicitly (amputation, irreversible diagnosis).
- "long_term": an injury or recovery measured in weeks or months → pass reviewInDays (when to re-ask) and a short phaseNote in the user's words.
- "short": a state that resolves in days (soreness, bad sleep, food poisoning, a tweak) → pass ttlDays and onExpiry: "forget" when it certainly passes, "ask_once" when it may leave a trace (a pain under load).

What is NOT a durable fact — leave it out of fact_operations (it belongs in the five list fields, or nowhere): one session's numbers, momentary state, anything a plan or session record already captures.

Categories (use exactly one per add/update): physical_constraint, exercise_preference, exercise_dislike, physiological_pattern, coaching_preference, schedule_constraint, equipment, nutrition_preference.

For a physical_constraint, set muscleGroup to the affected muscle group when identifiable (e.g. shoulders_front, lower_back, quads). Omit it otherwise.

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
