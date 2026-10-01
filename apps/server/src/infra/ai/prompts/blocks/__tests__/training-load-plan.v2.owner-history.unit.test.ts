/**
 * load-plan-fixes items 4 and 8 on the owner's real 45° Leg Press history (dev export 2026-10-01, copied into the
 * domain fixtures): the working weight follows the newest session, and the block prints the volume of the newest
 * performance against the previous one — as context; the recommendation does not depend on it.
 */
import { defaultProgression } from '@domain/training/load-plan';
import { LEG_PRESS_ROWS, ownerNow } from '@domain/training/load-facts/__tests__/fixtures';

import { decideLoadPlanEntry } from '@infra/ai/load-facts/load-decision';
import { loadLoadPlanEntries, type LoadFactsLoaderDeps } from '@infra/ai/load-facts/load-facts.loader';
import { sessionRow, sets, TZ } from '@infra/ai/load-facts/__tests__/rows';

import { renderLoadPlanEntryV2 } from '../training-load-plan.v2';

const LEG_PRESS = {
  id: '44444444-4444-4444-8444-444444444444',
  name: '45° Leg Press',
  muscles: [
    ['quads', 'primary'],
    ['glutes', 'primary'],
  ] as never,
};
const progression = defaultProgression(null);

function pastSessions(lastDate: string) {
  return LEG_PRESS_ROWS.filter(r => r.date <= lastDate).map(r => {
    const at = new Date(`${r.date}T04:00:00Z`);
    return sessionRow(`s-${r.date}`, new Date(at.getTime() - 3_600_000), [
      {
        rowId: `r-${r.date}`,
        ...LEG_PRESS,
        targetReps: r.targetReps,
        sets: r.sets.map(([weight, reps], i) => ({ weight, reps, at: new Date(at.getTime() + i * 120_000) })),
      },
    ]);
  });
}

async function blockFor(lastDate: string): Promise<{ text: string; entry: Awaited<ReturnType<typeof entries>>[0] }> {
  const [entry] = await entries(lastDate);
  const now = ownerNow(lastDate, 4);
  return { text: renderLoadPlanEntryV2(entry, { now, timezone: TZ, user: null }, { progression }), entry };
}

async function entries(lastDate: string) {
  const now = ownerNow(lastDate, 4);
  const past = pastSessions(lastDate);
  const today = sessionRow('today', now, [{ rowId: 'rt', ...LEG_PRESS, targetReps: '10-12', sets: [] }], {
    status: 'in_progress',
  });
  const deps = {
    workoutSessionRepo: {
      findRecentByUserIdWithDetails: async () => past,
      findLastPerformancesByExercise: async () => [],
      countRealPerformancesByExercise: async () => new Map([[LEG_PRESS.id, past.length]]),
    },
    exerciseRepository: { findByIdsWithMuscles: async () => [past[0].exercises[0].exercise] },
    trainingService: { getSessionDetails: async () => null },
    userFacts: { getConstraints: async () => [], getForPrompt: async () => [] },
  } as unknown as LoadFactsLoaderDeps;
  return loadLoadPlanEntries(deps, {
    userId: 'u1',
    session: today,
    exerciseIds: [LEG_PRESS.id],
    planTargetReps: new Map(),
    now,
    timezone: TZ,
  });
}

describe('AC-LPF-5 · leg press block follows the newest session', () => {
  it('after 09-21 the working weight is 120 kg (was the recurring 110)', async () => {
    const { text } = await blockFor('2026-09-21');
    expect(text).toContain('working weight 120 kg');
  });

  it('after 09-27 the working weight is at least 130 kg', async () => {
    const { text } = await blockFor('2026-09-27');
    expect(Number(/working weight (\d+(?:\.\d+)?) kg/.exec(text)?.[1])).toBeGreaterThanOrEqual(130);
  });
});

describe('AC-LPF-9 · the block prints volume of the newest vs the previous performance', () => {
  it('09-21 vs 09-16: +16 %, with both volumes and ages', async () => {
    const { text } = await blockFor('2026-09-21');
    expect(text).toContain('\n  volume: +16 % vs last (5520 vs 4760 kg×reps, working sets; 4 d and 9 d ago)');
  });

  it('09-27 vs 09-21', async () => {
    const { text } = await blockFor('2026-09-27');
    expect(text).toContain('volume: +10 % vs last (6060 vs 5520 kg×reps, working sets; 4 d and 10 d ago)');
  });

  it('prints a decrease with its sign, and nothing when there is no previous performance', async () => {
    const [entry] = await entries('2026-09-21');
    const down = {
      ...entry,
      facts: {
        ...entry.facts,
        volume: {
          unit: 'kg',
          newest: { volume: 900, daysAgo: 3 },
          previous: { volume: 1000, daysAgo: 9 },
          changePct: -10,
        },
      },
    } as typeof entry;
    const ctx = { now: ownerNow('2026-09-21', 4), timezone: TZ, user: null };
    expect(renderLoadPlanEntryV2(down, ctx, { progression })).toContain('volume: -10 % vs last (900 vs 1000 kg×reps');
    const none = { ...entry, facts: { ...entry.facts, volume: { absent: 'fewer than 2 performances with a load' } } };
    expect(renderLoadPlanEntryV2(none as typeof entry, ctx, { progression })).not.toContain('volume:');
  });

  it('no decision reads it: a different volume leaves the decision identical', async () => {
    const [entry] = await entries('2026-09-21');
    const changed = {
      ...entry,
      facts: {
        ...entry.facts,
        volume: {
          unit: 'kg',
          newest: { volume: 1, daysAgo: 1 },
          previous: { volume: 99999, daysAgo: 2 },
          changePct: -99,
        },
      },
    } as typeof entry;
    expect(decideLoadPlanEntry(changed, { progression })).toEqual(decideLoadPlanEntry(entry, { progression }));
  });
});
