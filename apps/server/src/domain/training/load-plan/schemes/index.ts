import { doubleProgression } from './double-progression';
import { linearProgression } from './linear-progression';
import type { ProgressionScheme } from './types';

export * from './types';
export * from './params';
export { doubleProgression, linearProgression };

export class UnknownSchemeError extends Error {
  constructor(public readonly schemeId: string) {
    super(`Unknown progression scheme: "${schemeId}"`);
    this.name = 'UnknownSchemeError';
  }
}

/** Registry keyed by scheme id; the version lives on the scheme and is recorded per log row. */
export const SCHEMES = {
  double_progression: doubleProgression,
  linear_progression: linearProgression,
} as const satisfies Record<string, ProgressionScheme>;

export type SchemeId = keyof typeof SCHEMES;

export function isSchemeId(id: string): id is SchemeId {
  return Object.prototype.hasOwnProperty.call(SCHEMES, id);
}

/** The scheme for `id`; an unknown id throws (a stored choice is validated against the registry). */
export function getScheme(id: string): ProgressionScheme {
  if (!isSchemeId(id)) {
    throw new UnknownSchemeError(id);
  }
  return SCHEMES[id];
}
