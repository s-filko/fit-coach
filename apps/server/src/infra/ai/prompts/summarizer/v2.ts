import type { ConversationPhase } from '@domain/conversation/ports';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface SummarizerV2Context {
  phase: ConversationPhase;
  /** compact's renderTranscript of the removed episode — the only input. */
  transcript: string;
}

/**
 * Episode summariser v2 (BR-LLM-004, ADR-0013 §3.3; ADR-0010 rationale):
 * independent structured summaries — no previousSummary is merged in, and
 * the schema instruction is explicit so `LlmGateway.structured` output fills
 * `EpisodeSummary` directly. "Facts only, no style"; English regardless of
 * the conversation language.
 */
export const SUMMARIZER_V2: PromptModule<SummarizerV2Context> = {
  id: 'summarizer',
  version: 'v2',
  directives: [],
  render({ phase, transcript }): Section[] {
    return [
      {
        id: 'system',
        required: true,
        text: `You summarise one ended conversation episode of a fitness-coaching chat into a structured record.
Return ONLY the structured output with these five fields, each an array of short English phrases:
- topics: what the episode was about
- decisions: agreements or choices made (plan structure, split, schedule changes)
- userState: stable facts about the user (injuries, preferences, constraints, life context)
- trainingFeedback: what worked or did not in training (subjective effort, pain, motivation)
- openItems: unfinished topics or promised follow-ups

Facts only, no style, no greetings, no filler. Include numbers (weights, reps, dates) only as facts, never as instructions. Use an empty array when a field has nothing for this episode. Write in English regardless of the conversation language.`,
      },
      {
        id: 'user',
        required: true,
        text: `EPISODE TRANSCRIPT (phase: ${phase}):\n${transcript}\n\nEpisode summary:`,
      },
    ];
  },
};
