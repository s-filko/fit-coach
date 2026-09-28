/**
 * Shared shape behind `LLM_PROFILE_<NAME>_<FIELD>` (llm-profiles.ts) and
 * `LLM_BUDGET_<PHASE>_<PART>` (llm-budget-overrides.ts), extracted (R2 close-out
 * finding) so both call sites share one regex-capture / lower-case / accumulate
 * loop and supply only their own per-field validation and assignment.
 */
export interface PrefixedEnvMatch {
  /** The full env var name, e.g. `LLM_PROFILE_SUMMARIZER_MODEL`. */
  key: string;
  /** The raw (non-empty, already-trimmed-checked) string value. */
  raw: string;
  /** The lower-cased first capture group — the profile/phase name. */
  name: string;
  /** The second capture group, verbatim (e.g. `MODEL`, `SYSTEM`). */
  field: string;
}

export interface ParsePrefixedEnvOptions<T> {
  env: NodeJS.ProcessEnv;
  /** Must have exactly two capture groups: the name, then the field/part token. */
  pattern: RegExp;
  /** Mutates the accumulator for `name` with this entry; may throw to reject a value. */
  assign?: (acc: T, match: PrefixedEnvMatch) => void;
}

/**
 * Scans `env` for keys matching `pattern`, skips unset/blank values, lower-cases
 * the captured name (group 1) and calls `assign` to fold each matching entry
 * into that name's accumulator record. Entries accumulate in first-seen order;
 * `assign` decides the per-field shape and validation, so this function itself
 * has no knowledge of what a valid value looks like.
 */
export function parsePrefixedEnv<T extends object = Record<string, unknown>>(
  options: ParsePrefixedEnvOptions<T>,
): Record<string, T> {
  const { env, pattern, assign } = options;
  const result: Record<string, T> = {};

  for (const [key, raw] of Object.entries(env)) {
    const match = pattern.exec(key);
    if (!match || raw == null || raw.trim() === '') {
      continue;
    }

    const [, capturedName, field] = match;
    const name = capturedName.toLowerCase();
    const acc = (result[name] ??= {} as T);
    assign?.(acc, { key, raw, name, field });
  }

  return result;
}
