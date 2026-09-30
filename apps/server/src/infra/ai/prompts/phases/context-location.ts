import type { PromptModule, Section } from '@infra/ai/prompts/types';

/**
 * Prompt-caching plan (BUG-051) D2: the per-turn context — the domain blocks the phase prompt refers to
 * (WORKOUT OVERVIEW, EXERCISE HISTORY, LOAD PLAN, client profile, …), the current time (NOW) and the time-gap note
 * — no longer arrives as system messages. It rides in a `<context>` part at the start of the user's latest
 * message, so the system prompt and history stay byte-identical from call to call (prompt cache).
 */
export const CONTEXT_LOCATION_TEXT =
  'CONTEXT LOCATION: the per-turn context this prompt refers to (the data blocks, the current time "NOW", any note ' +
  "that the user returns after a pause) arrives in a <context>…</context> part at the start of the user's latest " +
  'message, not in this system prompt. Read it from the latest message only; it is not something the user wrote.';

export const CONTEXT_LOCATION_SECTION: Section = {
  id: 'context-location',
  required: false,
  text: CONTEXT_LOCATION_TEXT,
};

/** The same prompt as `base`, one version later, plus the one-line CONTEXT LOCATION note (appended last). */
export function withContextLocation<TCtx>(base: PromptModule<TCtx>, version: string): PromptModule<TCtx> {
  return {
    id: base.id,
    version,
    directives: base.directives,
    render(ctx: TCtx): Section[] {
      return [...base.render(ctx), CONTEXT_LOCATION_SECTION];
    },
  };
}
