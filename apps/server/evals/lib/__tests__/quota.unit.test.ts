/**
 * readQuota (D-R, corrected 2026-09-18): the Z.AI monitor endpoint is real —
 * https://api.z.ai/api/monitor/usage/quota/limit, `Authorization: <Claude
 * Code subscription token>`. These tests pin the parsing and the fallbacks;
 * the fetcher and the token are injected, so nothing touches the network or
 * the developer's environment.
 */
const REAL_RESPONSE = {
  code: 200,
  msg: 'Operation successful',
  data: {
    limits: [
      { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 12000, currentValue: 6745, remaining: 5254, percentage: 56 },
      { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 60000, currentValue: 29817, remaining: 30182, percentage: 49 },
    ],
    level: 'pro',
  },
  success: true,
};

const FETCHER = async (): Promise<unknown> => REAL_RESPONSE;

describe('readQuota (Z.AI monitor API, D-R corrected)', () => {
  it('parses the 5-hour (unit 3) and weekly (unit 6) CREDIT_LIMIT remaining values', async () => {
    const { readQuota } = await import('../quota');
    const quota = await readQuota(FETCHER, 'test-token');
    expect(quota).toEqual({ fiveHourRemaining: 5254, weeklyRemaining: 30182, unit: 'credits' });
  });

  it('reads limits from the top-level fallback shape too (json.limits)', async () => {
    const { readQuota } = await import('../quota');
    const quota = await readQuota(async () => ({ limits: REAL_RESPONSE.data.limits }), 'test-token');
    expect(quota).not.toBeNull();
    expect(quota?.weeklyRemaining).toBe(30182);
  });

  it('returns null on a non-ok response (fetcher yields null)', async () => {
    const { readQuota } = await import('../quota');
    expect(await readQuota(async () => null, 'test-token')).toBeNull();
  });

  it('returns null when the plan exposes no CREDIT_LIMIT pair (manual flags take over)', async () => {
    const { readQuota } = await import('../quota');
    const tokensOnly = { data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 1 }] } };
    expect(await readQuota(async () => tokensOnly, 'test-token')).toBeNull();
  });

  it('returns null with no token (empty token, whatever the fetcher would say)', async () => {
    const { readQuota } = await import('../quota');
    expect(await readQuota(FETCHER, '')).toBeNull();
    expect(await readQuota(FETCHER, null)).toBeNull();
  });

  it('a token from ZAI_QUOTA_TOKEN env is used when the explicit one is not given', async () => {
    const prev = process.env['ZAI_QUOTA_TOKEN'];
    process.env['ZAI_QUOTA_TOKEN'] = 'env-token';
    try {
      const { readQuota } = await import('../quota');
      let seenToken = '';
      const quota = await readQuota(async (_url, token) => {
        seenToken = token;
        return REAL_RESPONSE;
      });
      expect(quota?.weeklyRemaining).toBe(30182);
      expect(seenToken).toBe('env-token');
    } finally {
      if (prev === undefined) {
        delete process.env['ZAI_QUOTA_TOKEN'];
      } else {
        process.env['ZAI_QUOTA_TOKEN'] = prev;
      }
    }
  });
});
