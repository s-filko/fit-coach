/**
 * TRANSITION_HANDOFF_TARGETS (transition-handoff plan Task 1, D-1, AC-TH-2) —
 * a comma list of conversation-phase names that get a silent same-run hand-off
 * when a transition tool commits to them. Empty/unset = off (today's graph,
 * byte-for-byte). Same tunables-not-secrets exception as EPISODE_* / LLM_PROFILE_*.
 *
 * Config imports nothing (architectural boundary — `boundaries/element-types`,
 * `config: allow: []`), so the phase names are a local literal union, kept in
 * sync with `@domain/conversation/phases`'s `ConversationPhase` by hand — the
 * two are structurally identical, so callers in `main`/`infra` assign this
 * result to a `ConversationPhase[]`-typed field with no cast.
 */
const KNOWN_PHASES = ['registration', 'chat', 'plan_creation', 'session_planning', 'training'] as const;

export type ConfigConversationPhase = (typeof KNOWN_PHASES)[number];

function isKnownPhase(value: string): value is ConfigConversationPhase {
  return (KNOWN_PHASES as readonly string[]).includes(value);
}

export function parseTransitionHandoffTargets(raw: string | undefined): ConfigConversationPhase[] {
  if (raw == null || raw.trim() === '') {
    return [];
  }
  const targets = raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '');
  for (const target of targets) {
    if (!isKnownPhase(target)) {
      throw new Error(
        `TRANSITION_HANDOFF_TARGETS: unknown phase "${target}" — must be one of: ${KNOWN_PHASES.join(', ')}`,
      );
    }
  }
  return targets as ConfigConversationPhase[];
}
