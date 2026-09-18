import type { ExportedRun } from './export-query';
import { pseudonymise, redactText, redactUser } from './redact';

/**
 * Build one draft case from an exported run. BR-EVAL-003: no raw identifier
 * leaves the exporter — runId is dropped entirely (its only value is inside
 * the dev DB; the export file name carries the date) and userId appears only
 * as a stable pseudonym. Returns null when the run has no human turn.
 */
export function buildDraftCase(run: ExportedRun, user: Record<string, unknown>): Record<string, unknown> | null {
  const firstName = (user['firstName'] as string | null) ?? null;
  const lastName = (user['lastName'] as string | null) ?? null;

  // `kind` is unreliable on production data (appendTurn leaves it at the column
  // default 'human' — same root cause as BUG-016); `role` is the discriminator.
  const humanTurns = run.turns.filter(t => t.role === 'user');
  const input = humanTurns[humanTurns.length - 1];
  if (!input) {
    return null;
  }
  // state.messages is the episode memory BEFORE the input turn — everything
  // that precedes it, not merely everything except the last turn.
  const inputIndex = run.turns.indexOf(input);

  return {
    id: `DRAFT-${run.runId?.slice(0, 8) ?? 'unknown'}`,
    phase: run.phase,
    tags: ['exported', 'needs-review'],
    fixture: { user: redactUser(user) },
    state: {
      phase: run.phase,
      messages: run.turns
        .slice(0, inputIndex)
        .map(t => ({ role: t.role === 'user' ? 'human' : 'ai', text: redactText(t.content, firstName, lastName) })),
    },
    input: { text: redactText(input.content, firstName, lastName) },
    expect: {},
    provenance: {
      addedBy: pseudonymise(run.userId),
      date: run.createdAt.toISOString().slice(0, 10),
    },
  };
}
