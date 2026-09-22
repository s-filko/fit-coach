/**
 * Pure formatting for `print-transcript` — no I/O, so this is unit-testable with
 * hand-built fixtures and integration-tested end to end via transcript-reader.ts's real queries.
 * Judged for readability, not machine-parseability (owner, 2026-09-22): a person reconstructing
 * what happened reads this, not a script.
 */
import type { RecordedRequestMessage, RecordLlmCallRequest, RecordLlmCallResponse } from '@infra/ai/llm-call-recorder';

import type { LlmCallRecord, RunTranscript, TurnRecord } from './transcript-reader';

export interface FormatOptions {
  /** Resolve and print the request/response payloads (large; off by default). */
  includePayloads: boolean;
}

type RequestMessage = RecordedRequestMessage;
type RequestPayload = RecordLlmCallRequest;
type ResponsePayload = RecordLlmCallResponse;

const time = (d: Date): string => d.toISOString();

function formatTurnLine(t: TurnRecord): string {
  const seqLabel = t.seq === null ? 'seq —' : `seq ${t.seq}`;
  const prefix = `[${time(t.createdAt)}] [${seqLabel}]`;
  switch (t.kind) {
    case 'human':
      return `${prefix} HUMAN: ${t.content}`;
    case 'ai':
      return t.content.length === 0
        ? `${prefix} AI: (no text — calling a tool, see below)`
        : `${prefix} AI: ${t.content}`;
    case 'tool_call': {
      const p = t.payload as { args?: unknown } | null;
      return `${prefix} TOOL_CALL ${t.content}(${JSON.stringify(p?.args ?? {})})`;
    }
    case 'tool_result': {
      const p = t.payload as { status?: string } | null;
      return `${prefix} TOOL_RESULT [${p?.status ?? 'unknown'}] ${t.content}`;
    }
    case 'system_note':
      return `${prefix} SYSTEM_NOTE: ${t.content}`;
    case 'summary':
      return `${prefix} SUMMARY: ${t.content}`;
    default:
      return `${prefix} ${t.kind.toUpperCase()}: ${t.content}`;
  }
}

function formatCallLine(c: LlmCallRecord): string {
  const prefix = `[${time(c.createdAt)}] [call ${c.callIndex}]`;
  const base = `${prefix} API CALL model=${c.model} latency=${c.latencyMs}ms`;
  return c.errorClass ? `${base} FAILED: ${c.errorClass}: ${c.errorMessage ?? '(no message)'}` : base;
}

/**
 * One resolved request message line — a system message with a hash prints what happened to it,
 * never an empty string. `seenHashes` is shared across the whole invocation (every call, every run):
 * the static rules block and per-run context blocks alike are stored once per distinct hash
 * (INV-LLM-008/BR-LLM-011's whole point) and are usually referenced again by the very next call in the same
 * run — printing the full text again every time would make a multi-call run's output dominated by
 * repeats of its own system prompt. First reference prints it in full; every later one, anywhere in
 * this run, points back to it instead.
 */
function formatRequestMessage(m: RequestMessage, blobs: Map<string, string | null>, seenHashes: Set<string>): string {
  if (m.role === 'system' && m.contentHash) {
    const { contentHash } = m;
    if (!blobs.has(contentHash)) {
      return `      [system] [hash ${contentHash} — not found in prompt_blobs]`;
    }
    const content = blobs.get(contentHash);
    if (content === null) {
      return `      [system] [payload aged out — retention pruned this prompt, hash ${contentHash}]`;
    }
    if (seenHashes.has(contentHash)) {
      return `      [system] [same prompt as shown earlier, hash ${contentHash}]`;
    }
    seenHashes.add(contentHash);
    return `      [system] ${content}`;
  }
  const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? null);
  return `      [${m.role}] ${text}`;
}

function formatCallDetail(c: LlmCallRecord, blobs: Map<string, string | null>, seenHashes: Set<string>): string[] {
  const lines: string[] = [];
  if (c.request === null) {
    lines.push('    request: [aged out — retention pruned this payload]');
  } else {
    const req = c.request as RequestPayload;
    const extras = [
      `temperature=${req.temperature === undefined ? 'default' : String(req.temperature)}`,
      req.reasoningEffort !== undefined ? `reasoningEffort=${String(req.reasoningEffort)}` : null,
      req.maxTokens !== undefined ? `maxTokens=${String(req.maxTokens)}` : null,
      req.topP !== undefined ? `topP=${String(req.topP)}` : null,
      req.stop !== undefined ? `stop=${JSON.stringify(req.stop)}` : null,
      req.responseFormat !== undefined ? `responseFormat=${JSON.stringify(req.responseFormat)}` : null,
      req.toolChoice !== undefined ? `toolChoice=${JSON.stringify(req.toolChoice)}` : null,
      req.tools && req.tools.length > 0 ? `tools=${req.tools.length}` : null,
    ].filter((x): x is string => x !== null);
    lines.push(`    request: model=${req.model} ${extras.join(' ')}`);
    for (const m of req.messages ?? []) {
      lines.push(formatRequestMessage(m, blobs, seenHashes));
    }
  }
  if (c.response !== null) {
    const res = c.response as ResponsePayload;
    const usage = res.usage ? ` tokensIn=${res.usage.promptTokens} tokensOut=${res.usage.completionTokens}` : '';
    lines.push(`    response: "${res.text ?? ''}" finishReason=${res.finishReason ?? 'null'}${usage}`);
  }
  return lines;
}

function formatRunHeader(rt: RunTranscript): string[] {
  const lines = [`=== RUN ${rt.runId} ===`];
  const { run } = rt;
  if (!run) {
    lines.push('  (no conversation_runs row for this run_id — it never reached commit and its');
    lines.push('   failed-run record failed to write too; only conversation_turns/llm_calls survive)');
    return lines;
  }
  lines.push(
    `  created: ${time(run.createdAt)}  phase: ${run.phaseIn} -> ${run.phaseOut ?? '(no transition)'}  ` +
      `model: ${run.model ?? '(none)'}  latency: ${run.latencyMs}ms`,
  );
  if (run.tokensIn !== null || run.tokensOut !== null) {
    lines.push(`  tokens: in=${run.tokensIn ?? '?'} out=${run.tokensOut ?? '?'}`);
  }
  lines.push(
    run.outcome === 'ok'
      ? '  outcome: ok'
      : `  >>> RUN FAILED: ${run.outcome} — ${run.errorClass ?? '(no class)'}: ${run.errorMessage ?? '(no message)'}`,
  );
  return lines;
}

/** True once ANY 'ai' turn carries visible text — a run can otherwise look "answered" by an empty tool-only AI row. */
function hasVisibleAnswer(turns: TurnRecord[]): boolean {
  return turns.some(t => t.kind === 'ai' && t.content.trim().length > 0);
}

type TimelineItem = { at: Date; isCall: boolean; render: () => string[] };

/**
 * Turns and calls, interleaved by when they actually happened — print-transcript's "in the order it
 * happened", across both tables, not just within one.
 */
function buildTimeline(
  rt: RunTranscript,
  blobs: Map<string, string | null>,
  opts: FormatOptions,
  seenHashes: Set<string>,
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...rt.turns.map(t => ({ at: t.createdAt, isCall: false, render: () => [formatTurnLine(t)] })),
    ...rt.llmCalls.map(c => ({
      at: c.createdAt,
      isCall: true,
      render: () => [formatCallLine(c), ...(opts.includePayloads ? formatCallDetail(c, blobs, seenHashes) : [])],
    })),
  ];
  // Stable sort by time; a call recorded at the exact same instant as a turn sorts first — the API
  // call that produced a turn is always recorded before commit writes the turn (Task 4/BUG-022).
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const byTime = a.item.at.getTime() - b.item.at.getTime();
      if (byTime !== 0) {
        return byTime;
      }
      if (a.item.isCall !== b.item.isCall) {
        return a.item.isCall ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

export function formatRunTranscript(
  rt: RunTranscript,
  blobs: Map<string, string | null>,
  opts: FormatOptions,
  seenHashes: Set<string> = new Set(),
): string {
  const lines = formatRunHeader(rt);

  if (rt.turns.some(t => t.seq === null)) {
    lines.push(
      '  ⚠ some rows below predate INV-LLM-010 (no seq) — their order among same-timestamp rows is not guaranteed',
    );
  }

  for (const item of buildTimeline(rt, blobs, opts, seenHashes)) {
    for (const line of item.render()) {
      lines.push(`  ${line}`);
    }
  }

  if (rt.turns.some(t => t.kind === 'human') && !hasVisibleAnswer(rt.turns)) {
    lines.push('  >>> NO ANSWER RECORDED — the user’s message has no model reply in the transcript (BUG-022)');
  }

  if (rt.turns.length === 0 && rt.llmCalls.length === 0) {
    lines.push('  (no conversation_turns or llm_calls rows for this run)');
  }

  return lines.join('\n');
}

export function formatTranscripts(
  transcripts: RunTranscript[],
  blobs: Map<string, string | null>,
  opts: FormatOptions,
): string {
  if (transcripts.length === 0) {
    return '(no runs found)';
  }
  // One shared cache across every run in this invocation — the static rules block, in particular,
  // is the same hash for every run in a session/user+window listing.
  const seenHashes = new Set<string>();
  return transcripts.map(rt => formatRunTranscript(rt, blobs, opts, seenHashes)).join('\n\n');
}
