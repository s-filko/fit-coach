/**
 * `# Profile` for the training system message (coach-simplification I1, AC-CS1-1): one line per fact, deduplicated.
 * The registration goal and body metrics are not shown (the i0 replay profile; a later sync task fixes the final
 * shape) — user-stated facts are newer and confirmed.
 * Pure (BR-LLM-007).
 */
import type { UserFact } from '@domain/user/ports';
import { parseProgressionFact, SCHEMES } from '@domain/user/services/fact-formats';
import type { User } from '@domain/user/services/user.service';

/** A pause in training is not shown to the coach (D14: `break` stays hidden). */
const DROPPED_CATEGORIES: ReadonlySet<string> = new Set(['break']);

function userLine(user: User | null): string | null {
  if (!user) {
    return null;
  }
  // The i0 replay profile carries only what the coach needs during a set: name and level — body metrics and the
  // registration goal made it talk about planning, not the set in front of it.
  const parts = [user.firstName, user.fitnessLevel].filter((p): p is string => typeof p === 'string' && p !== '');
  return parts.length > 0 ? parts.join(', ') : null;
}

/** One fact per (category, muscleGroup): the latest `updatedAt`, a tie goes to more confirmations. */
function dedupe(facts: UserFact[]): UserFact[] {
  const best = new Map<string, UserFact>();
  for (const f of facts) {
    if (f.muscleGroup == null) {
      continue;
    }
    const key = `${f.category}\u0000${f.muscleGroup}`;
    const cur = best.get(key);
    const newer =
      !cur ||
      f.updatedAt.getTime() > cur.updatedAt.getTime() ||
      (f.updatedAt.getTime() === cur.updatedAt.getTime() && f.confirmations > cur.confirmations);
    if (newer) {
      best.set(key, f);
    }
  }
  return facts.filter(f => f.muscleGroup == null || best.get(`${f.category}\u0000${f.muscleGroup}`) === f);
}

/**
 * A `progression_scheme` fact is stored as `progression_scheme id=<id> — <words>`: the coach sees the client's words
 * (the scheme's description when there are none), never the machine shape; a malformed one is not shown.
 */
function factLine(f: UserFact): string | null {
  if (f.category === 'progression_scheme') {
    const scheme = parseProgressionFact(f.fact);
    return scheme ? `Progression preference: ${scheme.words || SCHEMES[scheme.schemeId].description}` : null;
  }
  return f.durability === 'long_term' && f.phaseNote ? `${f.fact} (${f.phaseNote})` : f.fact;
}

export function renderTrainingProfile(user: User | null, facts: UserFact[]): string {
  const kept = dedupe(facts.filter(f => !DROPPED_CATEGORIES.has(f.category)));
  const ordered = [
    ...kept.filter(f => f.category === 'physical_constraint'),
    ...kept.filter(f => f.category !== 'physical_constraint'),
  ];
  const lines: string[] = [];
  const own = userLine(user);
  if (own) {
    lines.push(own);
  }
  lines.push(...ordered.map(factLine).filter((l): l is string => l !== null));
  return ['# Profile', ...(lines.length > 0 ? lines.map(l => `- ${l}`) : ['- No profile data yet.'])].join('\n');
}
