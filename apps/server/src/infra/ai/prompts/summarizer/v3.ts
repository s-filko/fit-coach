import type { ConversationPhase } from '@domain/conversation/ports';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface SummarizerV3Context {
  phase: ConversationPhase;
  /** compact's renderTranscript of the removed episode — the only input. */
  transcript: string;
}

/**
 * Episode summariser v3 (P6 Task 2, owner decision 2026-09-17): v2's five
 * fields plus a sixth, `facts` — the ONLY source of durable `user_facts` rows.
 * There is no per-turn fact-writing tool; extraction happens here, in the
 * summariser's one structured call, and is written to `user_facts` by the
 * `compact` node (Task 3), not by this prompt.
 *
 * D-D: `StoredEpisodeSummary`'s rendering (`episodeParagraph`,
 * `episode-summaries.v1.ts`) names its five original fields explicitly and
 * does not read `facts` — this field never reaches the `## Previous
 * episodes` block the user's next turn sees.
 */
export const SUMMARIZER_V3: PromptModule<SummarizerV3Context> = {
  id: 'summarizer',
  version: 'v3',
  directives: [],
  render({ phase, transcript }): Section[] {
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
- facts: durable facts worth remembering across future episodes (array of objects: { category, fact, muscleGroup? })

Facts only, no style, no greetings, no filler. Include numbers (weights, reps, dates) only as facts in the five list fields above, never as instructions. Write in English regardless of the conversation language.

FACTS FIELD — what counts as a durable fact:
A durable fact describes something that stays true across many future sessions: an injury or physical
constraint, an equipment limitation, a schedule constraint, or a lasting preference. Examples:
- "Can't do overhead press, shoulder injury" (category: physical_constraint, muscleGroup: shoulders_front)
- "Trains at home with dumbbells only" (category: equipment)
- "Prefers training in the evening" (category: schedule_constraint)
- "Dislikes burpees" (category: exercise_dislike)

What is NOT a durable fact — leave it out of facts (it belongs in the other five fields, or nowhere):
- One session's numbers: weights, reps, sets, RPE, or how a single workout went — that lives in the
  domain tables and training history, never in facts.
- Momentary state: "tired today", "sore right now", "did 3 sets" — episode chatter, not a lasting fact.
- Anything already captured by a plan or session record.

Categories (use exactly one per fact): physical_constraint, exercise_preference, exercise_dislike,
physiological_pattern, coaching_preference, schedule_constraint, equipment, nutrition_preference.

For a physical_constraint fact, set muscleGroup to the affected muscle group when the episode makes
one identifiable (e.g. shoulders_front, lower_back, quads) — this is what later blocks a conflicting
exercise. Omit muscleGroup when no specific muscle group applies or none is identifiable.

Use an empty array for facts when nothing in this episode qualifies as durable — an empty array is the
correct, expected answer most of the time. Do not invent a fact to avoid returning an empty array.`,
      },
      {
        id: 'user',
        required: true,
        text: `EPISODE TRANSCRIPT (phase: ${phase}):\n${transcript}\n\nEpisode summary:`,
      },
    ];
  },
};
