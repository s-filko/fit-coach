import { attributeCache, type CacheAttributionRequest, type PreviousCallLookup } from '@infra/ai/cache-attribution';
import {
  COURSE_DIRECTIVE_V1,
  EPISODE_SUMMARIES_V2,
  renderBlock,
  TIME_GAP_V1,
  USER_FACTS_V2,
} from '@infra/ai/prompts/blocks';

import { commonPrefixLength } from '@shared/common-prefix';

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

describe('canonical comparison across a jsonb round trip (close-out review, blocking R3)', () => {
  // Same tool schema as bindTools would send, but with the inner object's keys in the exact order
  // Postgres jsonb round-trips them (sorted by length, then bytewise — verified by the reviewer:
  // `type, $schema, required, properties, additionalProperties`). This is what `prev.request` looks
  // like after a real SELECT; `current` below is left in ordinary insertion order.
  const TOOL_SCHEMA_JSONB_ORDER = [
    {
      type: 'function',
      function: {
        name: 'log_set',
        parameters: {
          type: 'object',
          $schema: 'http://json-schema.org/draft-07/schema#',
          required: ['reps'],
          properties: { reps: { type: 'number' }, weight: { type: 'number' } },
          additionalProperties: false,
        },
        description: 'Logs a completed set.',
      },
    },
  ];
  const TOOL_SCHEMA_INSERTION_ORDER = [
    {
      type: 'function',
      function: {
        name: 'log_set',
        description: 'Logs a completed set.',
        parameters: {
          type: 'object',
          properties: { reps: { type: 'number' }, weight: { type: 'number' } },
          required: ['reps'],
          additionalProperties: false,
          $schema: 'http://json-schema.org/draft-07/schema#',
        },
      },
    },
  ];

  it('identical multi-key tool schemas compare equal (warm) regardless of jsonb key reordering', () => {
    const prev = req([{ role: 'system', content: PROMPT }], { tools: TOOL_SCHEMA_JSONB_ORDER });
    const current = req([{ role: 'system', content: PROMPT }], { tools: TOOL_SCHEMA_INSERTION_ORDER });

    const result = attributeCache(
      available(prev, secondsAgo(1)),
      { request: current, inputTokens: 5765, now: NOW },
      {},
    );

    expect(result.cacheExpected).toBe('warm');
  });

  it('an appended message after identical reordered tools is still warm, with a non-zero shared estimate', () => {
    const prev = req(
      [
        { role: 'system', content: PROMPT },
        { role: 'human', content: 'привет' },
      ],
      {
        tools: TOOL_SCHEMA_JSONB_ORDER,
      },
    );
    const current = req(
      [
        { role: 'system', content: PROMPT },
        { role: 'human', content: 'привет' },
        { role: 'assistant', content: 'Отлично!' },
        { role: 'human', content: 'следующий подход' },
      ],
      { tools: TOOL_SCHEMA_INSERTION_ORDER },
    );

    const result = attributeCache(
      available(prev, secondsAgo(1)),
      { request: current, inputTokens: 5765, now: NOW },
      {},
    );

    expect(result.cacheExpected).toBe('warm');
    expect(result.cacheSharedPrefixTokens).toBeGreaterThan(0);
  });

  it('an assistant tool_calls message with reordered nested keys compares equal too', () => {
    const prevToolCall = { id: 'c1', args: { weight: 80, reps: 8 }, name: 'log_set', type: 'tool_call' };
    const curToolCall = { id: 'c1', name: 'log_set', args: { reps: 8, weight: 80 }, type: 'tool_call' };
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'human', content: 'следующий подход' },
      { role: 'assistant', content: '', toolCalls: [prevToolCall] },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'human', content: 'следующий подход' },
      { role: 'assistant', content: '', toolCalls: [curToolCall] },
      { role: 'tool', content: 'Записано.', toolCallId: 'c1' },
    ]);

    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 200, now: NOW }, {});

    expect(result.cacheExpected).toBe('warm');
  });

  it('a genuinely different tool schema (not just reordered) still diverges as prefix_changed:tools', () => {
    const prev = req([{ role: 'system', content: PROMPT }], { tools: TOOL_SCHEMA_JSONB_ORDER });
    const current = req([{ role: 'system', content: PROMPT }], {
      tools: [{ type: 'function', function: { name: 'update_last_set', parameters: { type: 'object' } } }],
    });

    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 200, now: NOW }, {});

    expect(result.cacheExpected).toBe('prefix_changed:tools');
  });

  it('an undefined-valued key in the current request does not diverge against its jsonb-stored previous (JSON drops such keys)', () => {
    // JSON/jsonb serialization drops object keys whose value is undefined — so a request that
    // round-tripped through the DB loses them, while the in-memory `current` keeps them. The
    // canonical form must drop them the same way, or every such request reads as prefix_changed.
    const prev = req([{ role: 'system', content: PROMPT }], { tools: [{ name: 'x' }] });
    const current = req(
      [
        { role: 'system', content: PROMPT },
        { role: 'human', content: 'привет' },
      ],
      { tools: [{ id: undefined, name: 'x' }] },
    );

    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 100, now: NOW }, {});

    expect(result.cacheExpected).toBe('warm');
    expect(result.cacheDivergedAt).toBeNull();
  });

  it('the char offset for a genuine tools divergence is computed on the canonical form, not raw JSON', () => {
    // Both sides carry the SAME reordered shape up to a genuine value difference (the tool name) —
    // if the offset were computed on raw (non-canonical) JSON.stringify output, the two strings
    // would already differ at position 0 because of key order, giving a useless offset of 0.
    const prev = req([{ role: 'system', content: PROMPT }], { tools: TOOL_SCHEMA_JSONB_ORDER });
    const renamed = JSON.parse(JSON.stringify(TOOL_SCHEMA_JSONB_ORDER)) as typeof TOOL_SCHEMA_JSONB_ORDER;
    renamed[0]!.function.name = 'update_last_set';
    const current = req([{ role: 'system', content: PROMPT }], { tools: renamed });

    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 200, now: NOW }, {});

    expect(result.cacheExpected).toBe('prefix_changed:tools');
    const offset = Number(result.cacheDivergedAt!.split('@')[1]);
    expect(offset).toBeGreaterThan(0);
  });
});

describe('shared-prefix estimate accounts for tools/response_format text (advisory R3)', () => {
  const BIG_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'log_set',
        description: 'x'.repeat(2000),
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    },
  ];

  it('identical large tools contribute to the shared estimate, not just message text', () => {
    const prev = req(
      [
        { role: 'system', content: PROMPT },
        { role: 'human', content: 'привет' },
      ],
      {
        tools: BIG_TOOLS,
      },
    );
    const current = req(
      [
        { role: 'system', content: PROMPT },
        { role: 'human', content: 'привет' },
        { role: 'assistant', content: 'ок' },
        { role: 'human', content: 'следующий подход' },
      ],
      { tools: BIG_TOOLS },
    );

    const result = attributeCache(
      available(prev, secondsAgo(1)),
      { request: current, inputTokens: 3000, now: NOW },
      {},
    );

    // The large, identical tools block dominates the request — with it counted, almost everything
    // is shared; ignoring it (as the pre-fix formula did) would put this far below 90%.
    expect(result.cacheExpected).toBe('warm');
    expect(result.cacheSharedPrefixTokens).not.toBeNull();
    expect(result.cacheSharedPrefixTokens!).toBeGreaterThan(2500);
  });

  it('when tools differ, the shared estimate is 0 even though the messages are identical', () => {
    const prev = req([{ role: 'system', content: PROMPT }], { tools: BIG_TOOLS });
    const current = req([{ role: 'system', content: PROMPT }], {
      tools: [{ type: 'function', function: { name: 'other_tool' } }],
    });

    const result = attributeCache(
      available(prev, secondsAgo(1)),
      { request: current, inputTokens: 3000, now: NOW },
      {},
    );

    expect(result.cacheSharedPrefixTokens).toBe(0);
  });
});

describe('label derivation is tied to the real block templates (DRY, advisory R2)', () => {
  it('a changed ## User Facts block renders through USER_FACTS_V2 and is still labeled system:facts', () => {
    const before = renderBlock(USER_FACTS_V2, {
      facts: [
        {
          id: 'f1',
          category: 'training',
          fact: 'likes squats',
          factKey: 'likes-squats',
          confirmations: 1,
          durability: 'permanent',
          muscleGroup: null,
          phaseNote: null,
          updatedAt: new Date('2026-09-20T00:00:00.000Z'),
        } as never,
      ],
    });
    const after = renderBlock(USER_FACTS_V2, {
      facts: [
        {
          id: 'f1',
          category: 'training',
          fact: 'likes deadlifts',
          factKey: 'likes-squats',
          confirmations: 1,
          durability: 'permanent',
          muscleGroup: null,
          phaseNote: null,
          updatedAt: new Date('2026-09-20T00:00:00.000Z'),
        } as never,
      ],
    });
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: before },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: after },
    ]);

    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 200, now: NOW }, {});

    expect(result.cacheExpected).toBe('prefix_changed:system:facts');
  });

  it('a changed ## Course Directive block renders through COURSE_DIRECTIVE_V1 and is labeled system:directive', () => {
    const directive = (vector: string): never =>
      ({ vector, constraints: [], questions: [], suspectFacts: [], exerciseVerdicts: [] }) as never;
    const before = renderBlock(COURSE_DIRECTIVE_V1, { directive: directive('steady') });
    const after = renderBlock(COURSE_DIRECTIVE_V1, { directive: directive('deload') });
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: before },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: after },
    ]);

    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 200, now: NOW }, {});

    expect(result.cacheExpected).toBe('prefix_changed:system:directive');
  });

  it('a changed ## Previous episodes block renders through EPISODE_SUMMARIES_V2 and is labeled system:summaries', () => {
    const summary = (topic: string): never =>
      [
        {
          phaseAtEnd: 'chat',
          endedAt: '2026-09-20T00:00:00.000Z',
          summary: { topics: [topic], decisions: [], userState: [], trainingFeedback: [], openItems: [] },
        },
      ] as never;
    const before = renderBlock(EPISODE_SUMMARIES_V2, { summaries: summary('legs'), now: NOW, timezone: null });
    const after = renderBlock(EPISODE_SUMMARIES_V2, { summaries: summary('push'), now: NOW, timezone: null });
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: before },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'system', content: after },
    ]);

    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 200, now: NOW }, {});

    expect(result.cacheExpected).toBe('prefix_changed:system:summaries');
  });

  it('a changed time-gap note renders through TIME_GAP_V1 and is labeled system:gap-note', () => {
    const before = renderBlock(TIME_GAP_V1, { gapMs: 4 * 3_600_000 });
    const after = renderBlock(TIME_GAP_V1, { gapMs: 8 * 3_600_000 });
    const prev = req([
      { role: 'system', content: PROMPT },
      { role: 'human', content: 'привет' },
      { role: 'system', content: before },
      { role: 'human', content: 'следующий подход' },
    ]);
    const current = req([
      { role: 'system', content: PROMPT },
      { role: 'human', content: 'привет' },
      { role: 'system', content: after },
      { role: 'human', content: 'следующий подход' },
    ]);

    const result = attributeCache(available(prev, secondsAgo(1)), { request: current, inputTokens: 200, now: NOW }, {});

    expect(result.cacheExpected).toBe('prefix_changed:system:gap-note');
  });
});
