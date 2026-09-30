/**
 * D3-D6 (cache-accounting plan Task 1): a pure function comparing the request about to be sent
 * with the same user+model's previous `llm_calls` request, to tell a cache miss the TTL/provider
 * caused (nothing wrong, the window closed) from one a changed prefix caused (the `NOW` line, a
 * new fact, a different tool set) from one that is simply *unexplained* (same prefix, still a
 * miss). No I/O here — `llm-call-recorder.ts` fetches `prev` (the previous row, plus its system
 * messages' `prompt_blobs` content) and calls this; D7's "never fails a call" is that caller's
 * job, not this one's.
 *
 * Close-out review fix (2026-09-26, blocking R3): the previous request comes back from `jsonb`,
 * which does NOT preserve object key order (Postgres sorts by length then bytewise) — the current
 * request is still in insertion order. Comparing `JSON.stringify` output directly therefore never
 * matched even byte-identical tool schemas/tool_calls, making `warm` unreachable whenever a call
 * had tools. Every comparison and every char-offset below runs on `canonicalStringify`'s output —
 * object keys sorted recursively, arrays left in order (Postgres never reorders array elements) —
 * so both sides compare on the same footing regardless of which one round-tripped through jsonb.
 */
import { reasonCovers } from '@infra/ai/cache-break-reasons';
import { textOnly } from '@infra/ai/message-text';
import {
  COURSE_DIRECTIVE_HEADER,
  CURRENT_TIME_PREFIX,
  EPISODE_SUMMARIES_HEADER,
  TIME_GAP_PREFIX,
  USER_FACTS_HEADER,
} from '@infra/ai/prompts/blocks';

import { commonPrefixLength } from '@shared/common-prefix';

/** One message of a request, already resolved to comparable form — a system message carries its
 * actual text (never a bare hash: the recorder resolves `prev`'s hashes via `prompt_blobs` before
 * calling this). */
export interface CacheAttributionMessage {
  role: string;
  content?: unknown;
  toolCalls?: unknown;
  toolCallId?: string;
}

export interface CacheAttributionRequest {
  tools?: unknown;
  responseFormat?: unknown;
  messages: CacheAttributionMessage[];
}

/**
 * D5's `unknown`: the previous row's `request` was already pruned (BR-LLM-011) — its content is
 * gone, so no comparison is possible. `none`: no previous call at all — `cold`.
 */
export type PreviousCallLookup =
  | { kind: 'none' }
  | { kind: 'pruned'; createdAt: Date }
  | { kind: 'available'; request: CacheAttributionRequest; createdAt: Date };

export interface CacheLimits {
  /** LLM_CACHE_TTL_SECONDS — unset (null/undefined) means the provider's TTL is unknown: never `ttl_expired`. */
  ttlSeconds?: number | null;
  /** LLM_CACHE_MIN_PREFIX_TOKENS — unset means no minimum is known: never `too_short`. */
  minPrefixTokens?: number | null;
}

export interface CacheAttributionResult {
  cacheExpected: string;
  cacheDivergedAt: string | null;
  cacheSharedPrefixTokens: number | null;
  cacheGapMs: number | null;
  /**
   * Prompt-caching plan D8.3: `none` · `planned:<reason>` (a declared reason covers `where`) · `unplanned:<where>`
   * (the cacheable prefix diverged, nothing declared it) · `unexplained_miss` (expected warm, the provider read
   * clearly less than the shared prefix).
   */
  cacheBreak: string;
  /** Tokens the break cost (estimated from chars); null for `none` or when the input token count is unknown. */
  cacheBreakLostTokens: number | null;
  /** The `where` of a break (`unexplained_miss` for that class), null for `none`. */
  cacheBreakWhere: string | null;
  /** Chars into the diverging part where the prefix stopped matching; null when not applicable. */
  cacheBreakCharsInto: number | null;
}

/** The current call's own facts the classifier needs beyond the request itself. */
export interface CacheAttributionCurrent {
  request: CacheAttributionRequest;
  inputTokens: number | null;
  now: Date;
  /** What the provider reported as read from cache; null/undefined = unreported (never flagged). */
  cacheReadTokens?: number | null;
  /** The reasons this run declared for breaking the prefix (cache-break-reasons.ts). */
  declaredBreaks?: readonly string[];
}

const NO_BREAK = {
  cacheBreak: 'none',
  cacheBreakLostTokens: null,
  cacheBreakWhere: null,
  cacheBreakCharsInto: null,
} as const;

/** Provider reads round to block boundaries and the shared estimate is char-based: flag only a clear shortfall. */
const UNEXPLAINED_MISS_READ_RATIO = 0.75;

function gapMsOf(prevCreatedAt: Date, now: Date): number {
  return Math.max(0, now.getTime() - prevCreatedAt.getTime());
}

/**
 * A `JSON.stringify` that recursively sorts object keys (arrays keep their order — Postgres never
 * reorders array elements, only object keys) — so a value read back from `jsonb` compares equal to
 * the same value still in its original insertion order. The one normal form every comparison and
 * every char-offset in this module runs on (close-out review, blocking R3).
 */
function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    // Keys whose value is undefined or a function are dropped — JSON.stringify drops them on
    // write, so the stored side of the comparison never has them; keeping them here (as `"k":null`)
    // would diverge every request that merely carries one (follow-up to blocking R3).
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter(key => record[key] !== undefined && typeof record[key] !== 'function')
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** D4: system messages compare (and diff) by their resolved text; everything else by canonical serialized equality. */
/**
 * Content with the volatile markers removed: `cache_control` parts move every turn (breakpoint 2 rides the last
 * history message), and a system message sent as text parts must compare equal to the same text sent as a string.
 */
function normalisedContent(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return content;
  }
  return (content as unknown[]).map(part =>
    part !== null && typeof part === 'object'
      ? Object.fromEntries(Object.entries(part as Record<string, unknown>).filter(([k]) => k !== 'cache_control'))
      : part,
  );
}

function systemText(content: unknown): string {
  const parts = normalisedContent(content);
  return textOnly(parts) ?? canonicalStringify(parts ?? null);
}

function comparableText(m: CacheAttributionMessage): string {
  if (m.role === 'system') {
    return systemText(m.content);
  }
  return canonicalStringify({
    content: normalisedContent(m.content) ?? null,
    toolCalls: m.toolCalls ?? null,
    toolCallId: m.toolCallId ?? null,
  });
}

/** D4: the tools + response_format unit, canonicalized the same way as messages. */
function toolsCanonical(request: CacheAttributionRequest): string {
  return canonicalStringify({ tools: request.tools ?? null, responseFormat: request.responseFormat ?? null });
}

/** True when every message before `index` is itself a system message — the ADR-0013 §3.4 "block 1..3" run. */
function isLeadingSystemRun(messages: CacheAttributionMessage[], index: number): boolean {
  for (let i = 0; i < index; i++) {
    if (messages[i].role !== 'system') {
      return false;
    }
  }
  return true;
}

/**
 * D4's label derivation: `system:prompt` is always message 0 (assemble-context's fixed block 1);
 * the optional blocks that follow it are matched by their stable `##`/fixed-text header; the
 * gap-note is matched by its fixed opening phrase (`time-gap.v1.ts`) wherever it sits; a leading
 * system message matching none of these is the phase's domain block (no fixed header — it varies
 * per phase); anything else falls back to the raw `system[i]` the plan names for the undecidable
 * case. A non-system message is `history[i]:<role>`, `i` counted among non-system messages only —
 * the recorder never learns which of those came from "history" vs "current" (agent.node.ts's own
 * distinction), so this counts position, not domain meaning.
 */
function labelForMessage(messages: CacheAttributionMessage[], index: number): string {
  const m = messages[index];
  if (m.role !== 'system') {
    const historyIndex = messages.slice(0, index).filter(x => x.role !== 'system').length;
    return `history[${historyIndex}]:${m.role}`;
  }
  if (index === 0) {
    return 'system:prompt';
  }
  const text = typeof m.content === 'string' ? m.content : '';
  if (text.startsWith(USER_FACTS_HEADER)) {
    return 'system:facts';
  }
  if (text.startsWith(COURSE_DIRECTIVE_HEADER)) {
    return 'system:directive';
  }
  if (text.startsWith(EPISODE_SUMMARIES_HEADER)) {
    return 'system:summaries';
  }
  if (text.startsWith(TIME_GAP_PREFIX)) {
    return 'system:gap-note';
  }
  // now-line-last D4: the NOW message sits after history, wherever the
  // assembler put it — matched by its exported prefix, like the headers above.
  if (text.startsWith(CURRENT_TIME_PREFIX)) {
    return 'system:now';
  }
  if (isLeadingSystemRun(messages, index)) {
    return 'system:domain';
  }
  return `system[${index}]`;
}

const SYSTEM_SECTIONS: ReadonlyArray<readonly [string, string]> = [
  [USER_FACTS_HEADER, 'system:facts'],
  [COURSE_DIRECTIVE_HEADER, 'system:directive'],
  [EPISODE_SUMMARIES_HEADER, 'system:summaries'],
];
const SECTION_ORDER = ['system:prompt', 'system:facts', 'system:directive', 'system:summaries'];
/** Blocks inside the one stable system message are joined with this separator (assemble-context). */
const SECTION_SEPARATOR_LENGTH = 2;

function sectionAt(text: string, offset: number): string {
  let label = 'system:prompt';
  let labelPos = -1;
  for (const [header, name] of SYSTEM_SECTIONS) {
    const at = text.indexOf(header);
    if (at >= 0 && at - SECTION_SEPARATOR_LENGTH <= offset && at > labelPos) {
      label = name;
      labelPos = at;
    }
  }
  return label;
}

/**
 * D8 (T3 layout): block 1 + facts + directive + summaries are ONE SystemMessage, so a divergence inside it is
 * named by the block the char offset falls in. Evaluated on both texts and the EARLIER block wins — a block that
 * appeared or vanished shows up at a different place in each text, but the change starts where the first one starts.
 */
function systemSectionLabel(prevText: string, curText: string, offset: number): string {
  const a = sectionAt(prevText, offset);
  const b = sectionAt(curText, offset);
  return SECTION_ORDER.indexOf(a) <= SECTION_ORDER.indexOf(b) ? a : b;
}

interface MessageDiff {
  /** True when `prevMessages` is a full prefix of `curMessages` (possibly equal) — no divergence. */
  isPrefix: boolean;
  label: string | null;
  messageIndex: number | null;
  charOffset: number | null;
  sharedChars: number;
}

function diffMessages(prevMessages: CacheAttributionMessage[], curMessages: CacheAttributionMessage[]): MessageDiff {
  const max = Math.max(prevMessages.length, curMessages.length);
  let sharedChars = 0;
  for (let i = 0; i < max; i++) {
    const prevMsg = prevMessages[i];
    const curMsg = curMessages[i];
    if (prevMsg === undefined) {
      // Previous fully consumed — only new messages appended this call (warm).
      return { isPrefix: true, label: null, messageIndex: null, charOffset: null, sharedChars };
    }
    if (curMsg === undefined) {
      // The previous request had a message here that this one no longer sends (e.g. compaction
      // dropped it) — nothing of it is shared, labeled from the PREVIOUS message since there is
      // no current one to derive a label from.
      return { isPrefix: false, label: labelForMessage(prevMessages, i), messageIndex: i, charOffset: 0, sharedChars };
    }
    const prevText = comparableText(prevMsg);
    const curText = comparableText(curMsg);
    if (prevText === curText) {
      sharedChars += curText.length;
      continue;
    }
    const offset = commonPrefixLength(prevText, curText);
    return {
      isPrefix: false,
      label:
        i === 0 && curMsg.role === 'system'
          ? systemSectionLabel(prevText, curText, offset)
          : labelForMessage(curMessages, i),
      messageIndex: i,
      charOffset: offset,
      sharedChars: sharedChars + offset,
    };
  }
  return { isPrefix: true, label: null, messageIndex: null, charOffset: null, sharedChars };
}

function totalChars(messages: CacheAttributionMessage[]): number {
  return messages.reduce((n, m) => n + comparableText(m).length, 0);
}

/**
 * D8.2: the part of the previous request the provider could have cached — tools + every message BEFORE its last
 * user message (breakpoint 2 sits on the last message of history, right ahead of the current turn). What follows is
 * the previous turn's own volatile tail and never counts as a break.
 */
function cacheableMessages(messages: CacheAttributionMessage[]): CacheAttributionMessage[] {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  return lastUser > 0 ? messages.slice(0, lastUser) : messages;
}

export function attributeCache(
  prev: PreviousCallLookup,
  current: CacheAttributionCurrent,
  limits: CacheLimits,
): CacheAttributionResult {
  if (prev.kind === 'none') {
    return {
      cacheExpected: 'cold',
      cacheDivergedAt: null,
      cacheSharedPrefixTokens: null,
      cacheGapMs: null,
      ...NO_BREAK,
    };
  }
  const gapMs = gapMsOf(prev.createdAt, current.now);
  if (prev.kind === 'pruned') {
    return {
      cacheExpected: 'unknown',
      cacheDivergedAt: null,
      cacheSharedPrefixTokens: null,
      cacheGapMs: gapMs,
      ...NO_BREAK,
    };
  }

  // D4: tools + response_format compared first, as one unit — any difference means nothing after
  // it is cacheable either (an OpenAI-compatible wire request places the tool/response-format
  // framing ahead of the messages), so the shared estimate is 0 no matter how similar the
  // messages themselves are.
  const prevToolsText = toolsCanonical(prev.request);
  const curToolsText = toolsCanonical(current.request);
  const toolsEqual = prevToolsText === curToolsText;
  const prevCacheable = cacheableMessages(prev.request.messages);

  let label: string | null = null;
  let messageIndex: number | null = null;
  let charOffset: number | null = null;
  let messageSharedChars = 0;

  if (!toolsEqual) {
    label = 'tools';
    messageIndex = -1;
    charOffset = commonPrefixLength(prevToolsText, curToolsText);
  } else {
    const diff = diffMessages(prevCacheable, current.request.messages);
    ({ sharedChars: messageSharedChars } = diff);
    if (!diff.isPrefix) {
      ({ label, messageIndex, charOffset } = diff);
    }
  }

  // R3 advisory: the estimate must count the tools/response_format text too, not just messages —
  // a multi-thousand-token tool schema shared between calls otherwise never shows up as "shared"
  // at all, understating cacheSharedPrefixTokens whenever a call carries tools.
  const curTotalChars = curToolsText.length + totalChars(current.request.messages);
  const sharedChars = (toolsEqual ? curToolsText.length : 0) + messageSharedChars;
  const cacheSharedPrefixTokens =
    current.inputTokens !== null && curTotalChars > 0
      ? Math.round((current.inputTokens * sharedChars) / curTotalChars)
      : null;
  const cacheDivergedAt = label !== null ? `${label}#${messageIndex}@${charOffset}` : null;
  const tokensOf = (chars: number): number | null =>
    current.inputTokens !== null && curTotalChars > 0
      ? Math.round((current.inputTokens * chars) / curTotalChars)
      : null;

  const base = { cacheDivergedAt, cacheSharedPrefixTokens, cacheGapMs: gapMs };
  if (limits.ttlSeconds != null && gapMs > limits.ttlSeconds * 1000) {
    return { cacheExpected: 'ttl_expired', ...base, ...NO_BREAK };
  }
  const belowMinimum =
    limits.minPrefixTokens != null &&
    cacheSharedPrefixTokens !== null &&
    cacheSharedPrefixTokens < limits.minPrefixTokens;
  if (belowMinimum && label === null) {
    return { cacheExpected: 'too_short', ...base, ...NO_BREAK };
  }
  if (label === null) {
    // Warm: the cacheable prefix is intact. A provider read far below it is a miss nothing explains (D8.3).
    const read = current.cacheReadTokens;
    if (
      read != null &&
      cacheSharedPrefixTokens !== null &&
      cacheSharedPrefixTokens > 0 &&
      read < cacheSharedPrefixTokens * UNEXPLAINED_MISS_READ_RATIO
    ) {
      return {
        cacheExpected: 'warm',
        ...base,
        cacheBreak: 'unexplained_miss',
        cacheBreakLostTokens: cacheSharedPrefixTokens - read,
        cacheBreakWhere: 'unexplained_miss',
        cacheBreakCharsInto: null,
      };
    }
    return { cacheExpected: 'warm', ...base, ...NO_BREAK };
  }

  // A cacheable part changed: what the previous request could have cached and this one no longer shares.
  const prevChars = prevToolsText.length + totalChars(prevCacheable);
  const lostChars = Math.max(0, prevChars - sharedChars);
  const declared = (current.declaredBreaks ?? []).find(reason => reasonCovers(reason, label));
  return {
    // Below the provider's minimum the old wording stays (`too_short`); the break is classified either way — a
    // changed tool list or block 1 loses the whole cached prefix of the PREVIOUS call, whatever this one shares.
    cacheExpected: belowMinimum ? 'too_short' : `prefix_changed:${label}`,
    ...base,
    cacheBreak: declared !== undefined ? `planned:${declared}` : `unplanned:${label}`,
    cacheBreakLostTokens: tokensOf(lostChars),
    cacheBreakWhere: label,
    cacheBreakCharsInto: charOffset,
  };
}
