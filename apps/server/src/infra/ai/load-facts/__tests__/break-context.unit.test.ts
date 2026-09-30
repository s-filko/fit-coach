/**
 * load-plan Task 4 (AC-LP-6, D9): the training-break context — tier from the gap since the last real workout; the
 * reason question is asked once per break, the marker being a `break` fact with reason `unknown` that survives
 * restarts (it is a stored fact) and is never asked about again, even expired or archived.
 */
import type { UserFact } from '@domain/user/ports';

import { BreakContext } from '../break-context';

const NOW = new Date('2026-09-29T02:00:00Z');
const TZ = 'Asia/Manila';
const daysBefore = (d: number): Date => new Date(NOW.getTime() - d * 86_400_000);

function fact(text: string, over: Partial<UserFact> = {}): UserFact {
  return { id: 'f', category: 'break', fact: text, createdAt: NOW, ...over } as UserFact;
}

function build(
  opts: {
    lastWorkoutDaysAgo?: number | null;
    active?: UserFact[];
    archived?: UserFact[];
    expired?: UserFact[];
    rememberFails?: boolean;
  } = {},
) {
  const rememberFact = opts.rememberFails
    ? jest.fn().mockRejectedValue(new Error('db'))
    : jest.fn().mockResolvedValue({ outcome: 'created' });
  const days = opts.lastWorkoutDaysAgo === undefined ? 30 : opts.lastWorkoutDaysAgo;
  const ctx = new BreakContext({
    workoutSessionRepo: {
      findRecentByUserIdWithDetails: async () =>
        days === null ? [] : ([{ completedAt: daysBefore(days), createdAt: daysBefore(days) }] as never),
    },
    userFacts: {
      listFacts: async () => ({ active: opts.active ?? [], archived: opts.archived ?? [] }),
      getExpiredActive: async () => opts.expired ?? [],
      rememberFact,
    },
  });
  return { ctx, rememberFact };
}

describe('BreakContext.resolve', () => {
  it('no workout yet, or within the normal spacing → nothing to say, nothing stored', async () => {
    for (const d of [null, 0, 7]) {
      const { ctx, rememberFact } = build({ lastWorkoutDaysAgo: d });
      expect(await ctx.resolve('u1', NOW, TZ)).toBeNull();
      expect(rememberFact).not.toHaveBeenCalled();
    }
  });

  it.each([
    [8, 'rest_with_question'],
    [15, 'return'],
    [30, 'rebuild'],
    [100, 'restart'],
  ])('%i days → tier %s, the question is to be asked and the marker is stored once', async (days, tier) => {
    const { ctx, rememberFact } = build({ lastWorkoutDaysAgo: days });
    expect(await ctx.resolve('u1', NOW, TZ)).toEqual({ tier, days, ask: true });
    expect(rememberFact).toHaveBeenCalledTimes(1);
    const [[, input, now]] = rememberFact.mock.calls;
    expect(input).toMatchObject({ category: 'break', durability: 'short', ttlDays: 14, onExpiry: 'forget' });
    expect(input.fact).toMatch(/^break reason=unknown from=\d{4}-\d{2}-\d{2} to=2026-09-29$/);
    expect(now).toBe(NOW);
  });

  it('the marker dates: from = the last workout day, to = today, in the user timezone', async () => {
    const { ctx, rememberFact } = build({ lastWorkoutDaysAgo: 30 });
    await ctx.resolve('u1', NOW, TZ);
    expect(rememberFact.mock.calls[0][1].fact).toBe('break reason=unknown from=2026-08-30 to=2026-09-29');
  });

  it('an active break fact covering the gap (the marker itself, or the user’s answer) → not asked again', async () => {
    const marker = fact('break reason=unknown from=2026-08-30 to=2026-09-29');
    const { ctx, rememberFact } = build({ active: [marker] });
    expect(await ctx.resolve('u1', NOW, TZ)).toMatchObject({ tier: 'rebuild', ask: false });
    expect(rememberFact).not.toHaveBeenCalled();
  });

  it('an expired or archived marker still counts as asked (never asked again for the same break)', async () => {
    const old = fact('break reason=unknown from=2026-08-30 to=2026-09-10');
    for (const where of ['archived', 'expired'] as const) {
      const { ctx, rememberFact } = build({ [where]: [old] });
      expect(await ctx.resolve('u1', NOW, TZ)).toMatchObject({ ask: false });
      expect(rememberFact).not.toHaveBeenCalled();
    }
  });

  it('a break fact of an EARLIER break does not cover this gap → asked', async () => {
    const earlier = fact('break reason=illness from=2026-05-01 to=2026-05-20 — flu');
    const { ctx } = build({ active: [earlier] });
    expect(await ctx.resolve('u1', NOW, TZ)).toMatchObject({ ask: true });
  });

  it('a failed marker write skips the question — never asked on every message', async () => {
    const { ctx } = build({ rememberFails: true });
    expect(await ctx.resolve('u1', NOW, TZ)).toMatchObject({ tier: 'rebuild', ask: false });
  });

  it('never throws', async () => {
    const ctx = new BreakContext({
      workoutSessionRepo: { findRecentByUserIdWithDetails: async () => Promise.reject(new Error('db')) },
      userFacts: {} as never,
    });
    await expect(ctx.resolve('u1', NOW, TZ)).resolves.toBeNull();
  });
});
