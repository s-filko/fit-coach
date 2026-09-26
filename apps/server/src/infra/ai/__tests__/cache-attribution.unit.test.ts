import { attributeCache, type CacheAttributionRequest, type PreviousCallLookup } from '@infra/ai/cache-attribution';

const NOW = new Date('2026-09-26T12:00:00.000Z');
const secondsAgo = (n: number): Date => new Date(NOW.getTime() - n * 1000);

const PROMPT = 'You are the coach.\nNOW: 2026-09-26T11:59:00.000Z';
const FACTS = '## User Facts\n- likes squats';
const DIRECTIVE = '## Course Directive\n- Current course: steady';
const SUMMARIES = '## Previous episodes\nchat (today): stuff happened.';
const GAP_NOTE = 'The user returns after 4 h. Reply to their new message first.';

function req(
  messages: CacheAttributionRequest['messages'],
  overrides: Partial<CacheAttributionRequest> = {},
): CacheAttributionRequest {
  return { messages, ...overrides };
}

function available(request: CacheAttributionRequest, createdAt: Date): PreviousCallLookup {
  return { kind: 'available', request, createdAt };
}

function commonPrefixLength(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) {
    i++;
  }
  return i;
}

describe('attributeCache (D3-D6)', () => {
  it('AC-CA-3: no previous call → cold, no gap, no shared estimate', () => {
    const result = attributeCache(
      { kind: 'none' },
      { request: req([{ role: 'system', content: PROMPT }]), inputTokens: 100, now: NOW },
      {},
    );
    expect(result).toEqual({
      cacheExpected: 'cold',
      cacheDivergedAt: null,
      cacheSharedPrefixTokens: null,
      cacheGapMs: null,
    });
  });

  it('AC-CA-3: the previous request pruned (BR-LLM-011) → unknown, gap still recorded', () => {
    const result = attributeCache(
      { kind: 'pruned', createdAt: secondsAgo(30) },
      { request: req([{ role: 'system', content: PROMPT }]), inputTokens: 100, now: NOW },
      {},
    );
    expect(result.cacheExpected).toBe('unknown');
    expect(result.cacheDivergedAt).toBeNull();
    expect(result.cacheSharedPrefixTokens).toBeNull();
    expect(result.cacheGapMs).toBe(30_000);
  });

  it('AC-CA-3: previous is an exact prefix of current (only new messages appended) → warm', () => {
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'human', content: 'привет' },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'human', content: 'привет' },
      { role: 'ai', content: 'Здравствуй!' },
      { role: 'human', content: 'следующий подход' },
    ]);
    const result = attributeCache(
      available(prev, secondsAgo(5)),
      { request: current, inputTokens: 1000, now: NOW },
      {},
    );
    expect(result.cacheExpected).toBe('warm');
    expect(result.cacheDivergedAt).toBeNull();
    expect(result.cacheSharedPrefixTokens).toBeGreaterThan(0);
    expect(result.cacheGapMs).toBe(5000);
  });

  it('AC-CA-3: an identical request (degenerate case, zero new messages) is also warm', () => {
    const same = req([{ role: 'system', content: PROMPT }]);
    const result = attributeCache(available(same, secondsAgo(1)), { request: same, inputTokens: 500, now: NOW }, {});
    expect(result.cacheExpected).toBe('warm');
    expect(result.cacheSharedPrefixTokens).toBe(500);
  });

  it('AC-CA-3: a changed `## User Facts` block → prefix_changed:system:facts, with the diverged offset', () => {
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: FACTS },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: '## User Facts\n- likes deadlifts' },
    ]);
    const result = attributeCache(available(prev, secondsAgo(2)), { request: current, inputTokens: 200, now: NOW }, {});
    expect(result.cacheExpected).toBe('prefix_changed:system:facts');
    expect(result.cacheDivergedAt).toMatch(/^system:facts#1@\d+$/);
    const offset = Number(result.cacheDivergedAt!.split('@')[1]);
    expect(offset).toBe(commonPrefixLength(FACTS, '## User Facts\n- likes deadlifts'));
    expect(offset).toBeGreaterThan(0);
  });

  it('AC-CA-3: a changed NOW line inside the system prompt (block 1) → prefix_changed:system:prompt, offset at the NOW line', () => {
    const changedNow = 'You are the coach.\nNOW: 2026-09-26T12:00:00.000Z';
    const prev = req([{ role: 'system', content: PROMPT }]);
    const current = req([{ role: 'system', content: changedNow }]);
    const result = attributeCache(available(prev, secondsAgo(2)), { request: current, inputTokens: 200, now: NOW }, {});
    expect(result.cacheExpected).toBe('prefix_changed:system:prompt');
    expect(result.cacheDivergedAt).toMatch(/^system:prompt#0@\d+$/);
    const offset = Number(result.cacheDivergedAt!.split('@')[1]);
    expect(offset).toBe(commonPrefixLength(PROMPT, changedNow));
    expect(offset).toBeGreaterThan('You are the coach.\nNOW: 2026-09-26T'.length);
  });

  it('AC-CA-3: changed tools → prefix_changed:tools regardless of identical messages', () => {
    const { messages } = req([{ role: 'system', content: PROMPT }]);
    const prev = req(messages, { tools: [{ name: 'log_set' }] });
    const current = req(messages, { tools: [{ name: 'log_set' }, { name: 'update_last_set' }] });
    const result = attributeCache(available(prev, secondsAgo(2)), { request: current, inputTokens: 200, now: NOW }, {});
    expect(result.cacheExpected).toBe('prefix_changed:tools');
    expect(result.cacheDivergedAt).toMatch(/^tools#-1@\d+$/);
    expect(result.cacheSharedPrefixTokens).toBe(0);
  });

  it('AC-CA-3: a changed `response_format` alone is treated the same as changed tools', () => {
    const { messages } = req([{ role: 'system', content: PROMPT }]);
    const prev = req(messages, { responseFormat: { type: 'json_object' } });
    const current = req(messages, { responseFormat: { type: 'json_schema' } });
    const result = attributeCache(available(prev, secondsAgo(2)), { request: current, inputTokens: 200, now: NOW }, {});
    expect(result.cacheExpected).toBe('prefix_changed:tools');
  });

  it('AC-CA-3: TTL configured and exceeded → ttl_expired, even though the request is otherwise warm', () => {
    const same = req([{ role: 'system', content: PROMPT }]);
    const result = attributeCache(
      available(same, secondsAgo(120)),
      { request: same, inputTokens: 500, now: NOW },
      { ttlSeconds: 60 },
    );
    expect(result.cacheExpected).toBe('ttl_expired');
    expect(result.cacheGapMs).toBe(120_000);
  });

  it('AC-CA-3: TTL configured but not exceeded → falls through to the structural comparison (warm)', () => {
    const same = req([{ role: 'system', content: PROMPT }]);
    const result = attributeCache(
      available(same, secondsAgo(30)),
      { request: same, inputTokens: 500, now: NOW },
      { ttlSeconds: 60 },
    );
    expect(result.cacheExpected).toBe('warm');
  });

  it('AC-CA-3: a minimum configured and the shared estimate below it → too_short, even on a warm prefix', () => {
    const prev = req([{ role: 'system', content: 'x' }]);
    const current = req([
      { role: 'system', content: 'x' },
      { role: 'human', content: 'привет' },
    ]);
    const result = attributeCache(
      available(prev, secondsAgo(1)),
      { request: current, inputTokens: 100, now: NOW },
      { minPrefixTokens: 50 },
    );
    expect(result.cacheExpected).toBe('too_short');
  });

  it('AC-CA-3: unset TTL/minimum never produce ttl_expired/too_short', () => {
    const same = req([{ role: 'system', content: PROMPT }]);
    const result = attributeCache(
      available(same, secondsAgo(999_999)),
      { request: same, inputTokens: 1, now: NOW },
      {},
    );
    expect(result.cacheExpected).not.toBe('ttl_expired');
    expect(result.cacheExpected).not.toBe('too_short');
    expect(result.cacheExpected).toBe('warm');
  });

  it('the course-directive block is recognized by its header, independent of position among the leading blocks', () => {
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: DIRECTIVE },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: '## Course Directive\n- Current course: changed' },
    ]);
    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 100, now: NOW }, {});
    expect(result.cacheExpected).toBe('prefix_changed:system:directive');
  });

  it('the episode-summaries block is recognized by its header', () => {
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: SUMMARIES },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: '## Previous episodes\nsomething else.' },
    ]);
    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 100, now: NOW }, {});
    expect(result.cacheExpected).toBe('prefix_changed:system:summaries');
  });

  it('the gap-note is recognized by its fixed opening phrase', () => {
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'human', content: 'привет' },
      { role: 'system', content: GAP_NOTE },
      { role: 'human', content: 'следующий подход' },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'human', content: 'привет' },
      { role: 'system', content: 'The user returns after 8 h. Reply to their new message first.' },
      { role: 'human', content: 'следующий подход' },
    ]);
    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 100, now: NOW }, {});
    expect(result.cacheExpected).toBe('prefix_changed:system:gap-note');
  });

  it('a leading system block with no recognized header falls back to system:domain', () => {
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: '## Today’s Workout\nsquats' },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: '## Today’s Workout\ndeadlifts' },
    ]);
    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 100, now: NOW }, {});
    expect(result.cacheExpected).toBe('prefix_changed:system:domain');
  });

  it('a changed non-system message is labeled history[i]:<role>, indexed among non-system messages only', () => {
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'human', content: 'привет' },
      { role: 'ai', content: 'первый ответ' },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'human', content: 'привет' },
      { role: 'ai', content: 'другой ответ' },
    ]);
    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 100, now: NOW }, {});
    expect(result.cacheExpected).toBe('prefix_changed:history[1]:ai');
  });

  it('current shorter than previous (e.g. compaction dropped history) still produces a divergence, never a crash', () => {
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'human', content: 'привет' },
      { role: 'ai', content: 'ответ' },
    ]);
    const current = req([{ role: 'system', content: PROMPT }]);
    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 100, now: NOW }, {});
    expect(result.cacheExpected).toBe('prefix_changed:history[0]:human');
  });

  it('cacheSharedPrefixTokens is null when the current call reported no input token count', () => {
    const same = req([{ role: 'system', content: PROMPT }]);
    const result = attributeCache(available(same, secondsAgo(1)), { request: same, inputTokens: null, now: NOW }, {});
    expect(result.cacheSharedPrefixTokens).toBeNull();
    expect(result.cacheExpected).toBe('warm');
  });
});
