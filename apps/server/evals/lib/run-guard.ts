/**
 * Red-button call guard (D-P, PROMPT_EVAL_FRAMEWORK §7a — hardened 2026-09-18).
 * Pure helpers; the runner wires them to argv/env and prints the verdict.
 */

export interface GuardDecision {
  ok: boolean;
  plannedCalls: number;
  ceiling: number;
  message?: string;
}

/** Model calls a run will make: one per case per sample (+ tool rounds are not estimated). */
export function planCallCount(caseCount: number, samples: number): number {
  return caseCount * samples;
}

/**
 * Under the ceiling → run. Over the ceiling → refuse unless the red button
 * (`EVALS_FULL_RUN=1`, owner-launched) is pressed. The count is printed either
 * way — the owner sees the price before anything runs.
 */
export function guardDecision(plannedCalls: number, opts: { ceiling: number; fullRun: boolean }): GuardDecision {
  if (plannedCalls <= opts.ceiling) {
    return { ok: true, plannedCalls, ceiling: opts.ceiling };
  }
  if (opts.fullRun) {
    return {
      ok: true,
      plannedCalls,
      ceiling: opts.ceiling,
      message: `EVALS_FULL_RUN=1 set — running ${plannedCalls} planned calls over the ceiling of ${opts.ceiling}`,
    };
  }
  return {
    ok: false,
    plannedCalls,
    ceiling: opts.ceiling,
    message: `refusing to run: planned model calls ${plannedCalls} exceed EVALS_CALL_CEILING=${opts.ceiling}. Set EVALS_FULL_RUN=1 to override (red button, owner-launched).`,
  };
}

/** `--dataset <stem>` narrows a phase directory to `<stem>.jsonl` only. */
export function selectDatasetFiles(files: string[], dataset?: string): string[] {
  const jsonl = files.filter(f => f.endsWith('.jsonl'));
  if (!dataset) {
    return jsonl;
  }
  const wanted = `${dataset}.jsonl`;
  return jsonl.filter(f => f === wanted);
}
