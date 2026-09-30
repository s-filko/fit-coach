/**
 * Prompt-caching plan (BUG-051) T2 — AC-PC-9 / AC-PC-10 (D8.2–D8.3), the pure classifier.
 *
 * Interface assumed (T5b implements to it — recorded in the plan § Evidence, T2). `attributeCache`'s existing
 * signature is kept; the current-call argument gains two optional fields and the result two:
 *   current: { request, inputTokens, now, cacheReadTokens?: number | null, declaredBreaks?: string[] }
 *   result:  { …existing…, cacheBreak: string, cacheBreakLostTokens: number | null }
 *   cacheBreak ∈ 'none' | `planned:<reason>` | `unplanned:<where>` | 'unexplained_miss'
 *   `where` for a divergence inside the stable system message names the block the char offset falls in
 *   (system:prompt | system:facts | system:directive | system:summaries); `tools`; `history[<i>]:<role>`.
 * "Cacheable part" of the previous request = tools + every message BEFORE its last user message (breakpoint 2
 * sits on the last message of history); a difference after that point is the current turn and never a break.
 */
import { attributeCache, type CacheAttributionRequest, type PreviousCallLookup } from '@infra/ai/cache-attribution';

const NOW = new Date('2026-09-29T11:00:00Z');
const ago = (s: number): Date => new Date(NOW.getTime() - s * 1000);
const LIMITS = { ttlSeconds: 300, minPrefixTokens: 1024 };

const PROMPT = 'You are the training coach. '.repeat(200);
const FACTS = '\n\n## User Facts\n- likes squats';
const SUMMARIES = '\n\n## Previous episodes\nchat: talked about the split.';
const stable = (facts = FACTS) => `${PROMPT}${facts}${SUMMARIES}`;

const H0 = { role: 'user', content: 'привет' };
const A0 = { role: 'assistant', content: 'Привет! Начинаем?' };

function request(
  system: string,
  tail: Array<{ role: string; content: string }>,
  tools: unknown[] = [{ n: 'log_set' }],
) {
  return { tools, messages: [{ role: 'system', content: system }, H0, A0, ...tail] } as CacheAttributionRequest;
}

// Previous call: current turn = user h1 with its own <context>.
const prevRequest = request(stable(), [
  { role: 'user', content: '<context>NOW 11:59\nsquat: 0 sets</context>\nжим 60' },
]);
const prev = (createdAt = ago(60)): PreviousCallLookup => ({ kind: 'available', request: prevRequest, createdAt });

/** The next run: history now carries h1 raw + a1; new current turn h2. */
const nextTail = [
  { role: 'user', content: 'жим 60' },
  { role: 'assistant', content: 'Записал' },
  { role: 'user', content: '<context>NOW 12:00\nsquat: 1 set</context>\nещё' },
];

function attribute(
  cur: CacheAttributionRequest,
  extra: { cacheReadTokens?: number | null; declaredBreaks?: string[] } = {},
  previous: PreviousCallLookup = prev(),
) {
  return attributeCache(
    previous,
    { request: cur, inputTokens: 5000, now: NOW, ...extra } as Parameters<typeof attributeCache>[1],
    LIMITS,
  ) as ReturnType<typeof attributeCache> & { cacheBreak: string; cacheBreakLostTokens: number | null };
}

describe('AC-PC-9: prefix change classification (D8.2–D8.3)', () => {
  it('AC-PC-9: a change only after breakpoint 2 (the previous current turn) is none', () => {
    const result = attribute(request(stable(), nextTail), { cacheReadTokens: 4000 });
    expect(result.cacheBreak).toBe('none');
  });

  it('AC-PC-9: stable system message changed, no declared reason → unplanned:<where>, tokens lost > 0', () => {
    const result = attribute(request(stable('\n\n## User Facts\n- likes squats\n- new knee injury'), nextTail), {
      cacheReadTokens: 0,
    });
    expect(result.cacheBreak).toBe('unplanned:system:facts');
    expect(result.cacheBreakLostTokens).toBeGreaterThan(0);
  });

  it('AC-PC-9: block 1 (phase prompt) changed, no declared reason → unplanned:system:prompt', () => {
    const result = attribute(request(stable().replace('training coach', 'chat coach'), nextTail), {
      cacheReadTokens: 0,
    });
    expect(result.cacheBreak).toBe('unplanned:system:prompt');
  });

  it('AC-PC-9: the same change with its reason declared → planned:<reason>', () => {
    const cur = request(stable('\n\n## User Facts\n- likes squats\n- new knee injury'), nextTail);
    expect(attribute(cur, { cacheReadTokens: 0, declaredBreaks: ['facts_changed'] }).cacheBreak).toBe(
      'planned:facts_changed',
    );
  });

  it('AC-PC-9: a declared reason that does not cover where it broke stays unplanned', () => {
    const cur = request(stable('\n\n## User Facts\n- likes squats\n- new knee injury'), nextTail);
    expect(attribute(cur, { cacheReadTokens: 0, declaredBreaks: ['compaction'] }).cacheBreak).toBe(
      'unplanned:system:facts',
    );
  });

  it('AC-PC-9: the tool list changed → unplanned:tools; declared phase_switch → planned:phase_switch', () => {
    const cur = request(stable(), nextTail, [{ n: 'log_set' }, { n: 'delete_last_sets' }]);
    expect(attribute(cur, { cacheReadTokens: 0 }).cacheBreak).toBe('unplanned:tools');
    expect(attribute(cur, { cacheReadTokens: 0, declaredBreaks: ['phase_switch'] }).cacheBreak).toBe(
      'planned:phase_switch',
    );
  });

  it('AC-PC-9: history rewritten inside the cacheable part → unplanned:history[<i>]:<role>; compaction declared → planned', () => {
    const cur = {
      tools: prevRequest.tools,
      messages: [
        { role: 'system', content: stable() },
        { role: 'user', content: 'привет (rewritten)' },
        A0,
        { role: 'user', content: 'жим 60' },
      ],
    } as CacheAttributionRequest;
    expect(attribute(cur, { cacheReadTokens: 0 }).cacheBreak).toBe('unplanned:history[0]:user');
    expect(attribute(cur, { cacheReadTokens: 0, declaredBreaks: ['compaction'] }).cacheBreak).toBe(
      'planned:compaction',
    );
  });

  it('AC-PC-9: a gap past the TTL is ttl_expired, never a break', () => {
    const cur = request(stable('\n\n## User Facts\n- changed'), nextTail);
    const result = attribute(cur, { cacheReadTokens: 0 }, prev(ago(600)));
    expect(result.cacheExpected).toBe('ttl_expired');
    expect(result.cacheBreak).toBe('none');
  });
});

describe('AC-PC-10: expected warm, provider read below the shared prefix (D8.3)', () => {
  const cur = request(stable(), nextTail);

  it('AC-PC-10: same cacheable prefix, provider read 0 → unexplained_miss with tokens lost', () => {
    const result = attribute(cur, { cacheReadTokens: 0 });
    expect(result.cacheExpected).toBe('warm');
    expect(result.cacheBreak).toBe('unexplained_miss');
    expect(result.cacheBreakLostTokens).toBeGreaterThan(0);
  });

  it('AC-PC-10: provider read covers the shared prefix → none', () => {
    const result = attribute(cur, { cacheReadTokens: result0().cacheSharedPrefixTokens ?? 0 });
    expect(result.cacheBreak).toBe('none');
  });

  it('AC-PC-10: provider did not report a read (null) → none, never flagged on an unknown', () => {
    expect(attribute(cur, { cacheReadTokens: null }).cacheBreak).toBe('none');
  });

  function result0() {
    return attribute(cur, { cacheReadTokens: 0 });
  }
});

describe('AC-PC-9 / AC-PC-10: the breakpoint marker and the string/parts shape never make a break (dev smoke 2026-09-30)', () => {
  const bp = { type: 'ephemeral' };
  const parts = (text: string, marker?: unknown) => [
    { type: 'text', text, ...(marker ? { cache_control: marker } : {}) },
  ];
  const req = (system: unknown, history: Array<{ role: string; content: unknown }>, current: string) =>
    ({
      tools: [{ n: 'log_set' }],
      messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: current }],
    }) as CacheAttributionRequest;
  const H1 = { role: 'user', content: 'привет' };
  const A1 = 'Привет! Начинаем тренировку?';

  it('AC-PC-9: last history assistant sent as parts+cache_control (bp2), next call as a plain string → warm, none', () => {
    const previous = req(stable(), [H1, { role: 'assistant', content: parts(A1, bp) }], '<context>a</context>жим');
    const cur = req(
      stable(),
      [
        H1,
        { role: 'assistant', content: A1 },
        { role: 'user', content: 'жим' },
        { role: 'assistant', content: parts('Записал', bp) },
      ],
      '<context>b</context>ещё',
    );
    const result = attributeCache(
      { kind: 'available', request: previous, createdAt: ago(60) },
      { request: cur, inputTokens: 5271, now: NOW, cacheReadTokens: 4951 },
      LIMITS,
    );
    expect(result.cacheExpected).toBe('warm');
    expect(result.cacheBreak).toBe('none');
    expect(result.cacheDivergedAt).toBeNull();
  });

  it('AC-PC-9: the stable system message — parts with bp1 vs the same text as a string — compares equal', () => {
    const previous = req(parts(stable(), bp), [H1, { role: 'assistant', content: A1 }], 'x');
    const cur = req(
      stable(),
      [H1, { role: 'assistant', content: A1 }, { role: 'user', content: 'x' }, { role: 'assistant', content: 'ok' }],
      'y',
    );
    const result = attributeCache(
      { kind: 'available', request: previous, createdAt: ago(60) },
      { request: cur, inputTokens: 5000, now: NOW, cacheReadTokens: 4500 },
      LIMITS,
    );
    expect(result.cacheBreak).toBe('none');
  });

  it('AC-PC-10: a ToolMessage carrying bp2 (parts) then the same result as a string compares equal — no false break, no false miss', () => {
    const tool = (content: unknown) => ({ role: 'tool', content, toolCallId: 'c1' });
    const previous = req(stable(), [H1, tool(parts('Logged set 1', bp))], 'x');
    const cur = req(stable(), [H1, tool('Logged set 1'), { role: 'assistant', content: 'ok' }], 'y');
    const result = attributeCache(
      { kind: 'available', request: previous, createdAt: ago(60) },
      { request: cur, inputTokens: 5000, now: NOW, cacheReadTokens: 4500 },
      LIMITS,
    );
    expect(result.cacheExpected).toBe('warm');
    expect(result.cacheBreak).toBe('none');
  });

  it('AC-PC-9: a real text change is still a break (the normalisation only removes shape and marker)', () => {
    const previous = req(stable(), [H1, { role: 'assistant', content: parts(A1, bp) }], 'x');
    const cur = req(
      stable(),
      [H1, { role: 'assistant', content: 'Совсем другой ответ' }, { role: 'user', content: 'x' }],
      'y',
    );
    const result = attributeCache(
      { kind: 'available', request: previous, createdAt: ago(60) },
      { request: cur, inputTokens: 5000, now: NOW, cacheReadTokens: 0 },
      LIMITS,
    );
    expect(result.cacheBreak).toBe('unplanned:history[1]:assistant');
  });

  it('AC-PC-9: content with a non-text part is not flattened — an image part vs its text-only twin still differs', () => {
    const previous = req(
      stable(),
      [
        H1,
        {
          role: 'assistant',
          content: [
            { type: 'text', text: A1 },
            { type: 'image_url', image_url: { url: 'u' } },
          ],
        },
      ],
      'x',
    );
    const cur = req(stable(), [H1, { role: 'assistant', content: A1 }, { role: 'user', content: 'x' }], 'y');
    const result = attributeCache(
      { kind: 'available', request: previous, createdAt: ago(60) },
      { request: cur, inputTokens: 5000, now: NOW, cacheReadTokens: 0 },
      LIMITS,
    );
    expect(result.cacheBreak).toBe('unplanned:history[1]:assistant');
  });
});
