/**
 * The LLM boundary callback: debug logging of every model invocation (BUG-003
 * replay payload) AND — since INV-LLM-008 — its durable record, independent of
 * LOG_LEVEL. Run metrics live in the per-run collector's handler (run
 * context) since refactor-p3-run-context-commit; this handler logs and
 * records.
 *
 * One instance lives for the process (model.factory.ts's single construction
 * site, one per profile, cached) — it sees every call of every run, so the
 * DB write below is keyed by `metadata.runId` per call, never by instance
 * state (AC-1331: no shared mutable state that could leak across runs). A
 * call whose metadata carries no runId (a background job — llm.gateway.ports
 * `LlmCallOptions.jobId`) is logged but never recorded to `llm_calls`: the
 * table's `run_id` is not nullable, and "one row per model call" (INV-LLM-008) is
 * scoped to conversation runs, the transcript of record this plan protects.
 */

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { BaseMessage } from '@langchain/core/messages';

import { loadConfig } from '@config/index';

import { classifyError } from '@shared/classify-error';
import { createLogger } from '@shared/logger';

import {
  type RecordedRequestMessage,
  recordLlmCall,
  type RecordLlmCall,
  type RecordLlmCallRequest,
} from './llm-call-recorder';

const log = createLogger('llm');

// Config is read on first use, not at import: this module sits on the import
// path of the eval runner (run-case → conversation-run.adapter → episode →
// llm.gateway → model.factory), and L0 runs in CI without a .env. An
// import-time loadConfig() there fails the whole L0 step (dev deploys were red
// from f8387ee6 to bbed9f50 because of it).
let cached: ReturnType<typeof loadConfig> | null = null;
function config(): ReturnType<typeof loadConfig> {
  cached ??= loadConfig();
  return cached;
}

function messageToOpenAI(msg: BaseMessage): RecordedRequestMessage {
  const type = msg._getType();
  let role: string;
  if (type === 'human') {
    role = 'user';
  } else if (type === 'ai') {
    role = 'assistant';
  } else {
    role = type;
  }
  const base: RecordedRequestMessage = { role, content: msg.content };
  if (type === 'ai' && 'tool_calls' in msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    base.tool_calls = msg.tool_calls;
  }
  if (type === 'tool' && 'tool_call_id' in msg) {
    base.tool_call_id = msg.tool_call_id as string;
  }
  return base;
}

// INV-LLM-008's allow-list: `invocation_params` fields beyond model/temperature/tools/reasoning_effort
// that a profile or call may set and that must be stored, mapped snake_case → the same camelCase
// convention `reasoningEffort` already uses. None of these is ever a credential — invocation_params
// is LangChain's per-call request shape, never the client's transport config (see the credentials
// test) — so copying whichever of these are present is as safe as the fields already copied above.
//
// `maxTokens` has two possible wire keys, never both at once: `@langchain/openai`
// completions.js:59 (isReasoningModel, utils/misc.js:5) sends `max_completion_tokens` for `o`-series
// / `gpt-5*` models and `max_tokens` for every other model. The same file's
// only other model-conditional key is `reasoning_effort` (completions.js:58), already covered by
// BASE_RECORDED_INVOCATION_PARAM_KEYS below.
type ExtraInvocationField = 'maxTokens' | 'responseFormat' | 'topP' | 'stop' | 'toolChoice';

export const EXTRA_INVOCATION_PARAM_FIELDS: ReadonlyArray<[ExtraInvocationField, string]> = [
  ['maxTokens', 'max_tokens'],
  ['maxTokens', 'max_completion_tokens'],
  ['responseFormat', 'response_format'],
  ['topP', 'top_p'],
  ['stop', 'stop'],
  ['toolChoice', 'tool_choice'],
];

// `model`/`temperature`/`tools`/`reasoning_effort` are recorded
// too, but by the bespoke logic below (`tools` in particular comes from `options`, not
// `invocation_params`, though the two carry the same content) rather than the EXTRA_ table above.
// Listed here so the guard test (llm-log-handler.unit.test.ts) can compute full invocation_params
// coverage from production code, without hand-duplicating this file's own extraction logic.
export const BASE_RECORDED_INVOCATION_PARAM_KEYS: ReadonlySet<string> = new Set([
  'model',
  'temperature',
  'tools',
  'reasoning_effort',
]);

/**
 * `invocation_params` keys LangChain's ChatOpenAI can populate that buildReplayPayload must NEVER
 * copy into a stored request — this is the credential/transport boundary, kept explicit rather than
 * left as "whatever the whitelist above doesn't mention" so a reviewer can read the whole boundary
 * in one place, and so the guard test can name a genuinely new, undecided key instead of always
 * treating one of these as an omission.
 */
export const NEVER_RECORD_INVOCATION_PARAM_KEYS: ReadonlyMap<string, string> = new Map([
  [
    'stream',
    // Wire-protocol shape (SSE vs one response), not content the model was asked — and always
    // `false` here (this codebase never requests streaming), so it would never even vary.
    'transport: whether the HTTP response streams, not part of what was asked',
  ],
]);

/**
 * The exact request payload an invocation sends (BUG-003 / INV-LLM-008) — the full set of parameters
 * LangChain actually built for the call, not a hand-picked subset. Built from LangChain's own
 * `invocation_params`/`options`, never from transport config: an API key or Authorization header
 * lives on the client, not in these, so neither this function nor anything it returns can carry one
 * (see the credentials test). The ONE construction site — the debug log and the DB record both call
 * this, never rebuild the shape themselves.
 */
export function buildReplayPayload(
  flatMessages: BaseMessage[],
  extraParams: Record<string, unknown> | undefined,
  cfg: ReturnType<typeof loadConfig>,
): RecordLlmCallRequest {
  const options = extraParams?.['options'] as Record<string, unknown> | undefined;
  const invocationParams = extraParams?.['invocation_params'] as Record<string, unknown> | undefined;
  const invocationModel = (invocationParams?.['model'] as string | undefined) ?? cfg.LLM_MODEL;
  const tools = options?.['tools'] as unknown[] | undefined;

  const payload: RecordLlmCallRequest = {
    model: invocationModel,
    messages: flatMessages.map(messageToOpenAI),
    temperature: invocationParams?.['temperature'] ?? cfg.LLM_TEMPERATURE,
  };
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }
  const reasoningEffort = invocationParams?.['reasoning_effort'];
  if (reasoningEffort !== undefined) {
    payload.reasoningEffort = reasoningEffort;
  }
  for (const [field, invocationKey] of EXTRA_INVOCATION_PARAM_FIELDS) {
    const value = invocationParams?.[invocationKey];
    if (value !== undefined) {
      payload[field] = value;
    }
  }
  return payload;
}

interface PendingCall {
  runId: string;
  model: string;
  request: RecordLlmCallRequest;
  startedAt: number;
}

interface LlmGeneration {
  text: string;
  message?: { tool_calls?: unknown };
  generationInfo?: Record<string, unknown>;
}

export class LLMLogHandler extends BaseCallbackHandler {
  name = 'LLMLogHandler';

  // llmRunId → the call's request + start time, bridging handleChatModelStart
  // to handleLLMEnd/handleLLMError (LangChain's own per-call id, never ours —
  // AC-1331-style: keyed by call, not by run, so concurrent runs never collide).
  private readonly pending = new Map<string, PendingCall>();

  constructor(private readonly recordCall: RecordLlmCall = recordLlmCall) {
    super();
    // INV-LLM-008: LangChain's default (LANGCHAIN_CALLBACKS_BACKGROUND unset, same as
    // this repo) queues a handler's callbacks in the background — the call resolves
    // before handleLLMEnd/handleLLMError, and this recorder's write, ever runs. For
    // the one table whose whole purpose is a trustworthy record, "probably written
    // shortly afterwards" is not "stored": a deploy stops the process, and whatever
    // is still queued is gone, silently. This is the supported PER-HANDLER override
    // (base.js's `awaitHandlers`) — deliberately not the LANGCHAIN_CALLBACKS_BACKGROUND
    // env var, which would change every handler's behaviour, including any future
    // one that has no reason to block the call it watches. The cost is one insert
    // (single-digit ms) on a call that takes tens of seconds; the recorder already
    // swallows its own errors (see handleLLMEnd/handleLLMError below), so awaiting
    // it cannot turn a recording failure into a reply failure.
    this.awaitHandlers = true;
  }

  handleChatModelStart(
    _llm: Serialized,
    messages: BaseMessage[][],
    llmRunId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): void {
    const flat = messages[0] ?? [];
    const system = flat.find(m => m._getType() === 'system');
    const humanMsgs = flat.filter(m => m._getType() === 'human');
    const lastHuman = humanMsgs[humanMsgs.length - 1];
    // LangChain strips `configurable` from the options a callback sees
    // (runnables/base.js `_separateRunnableConfigFromCallOptions` deletes it), so
    // userId/runId travel via config metadata — inherited by every nested model
    // call (agent.node.ts threads its LangGraph `config` through; llm.gateway.ts's
    // callConfig sets it explicitly for course-check/compaction's direct calls).
    const userId = metadata?.['userId'] as string | undefined;
    const runId = metadata?.['runId'] as string | undefined;
    const cfg = config();
    const isDebug = cfg.LOG_LEVEL === 'debug' || cfg.LOG_LEVEL === 'trace';

    // INV-LLM-008: built unconditionally — the DB record does not wait on LOG_LEVEL,
    // only the extra debug log line below does.
    const replayPayload = buildReplayPayload(flat, extraParams, cfg);

    if (isDebug) {
      log.debug({ userId, totalMessages: flat.length, replayPayload }, 'LLM invoke [debug]');
    } else {
      log.debug(
        {
          userId,
          totalMessages: flat.length,
          systemPromptLength: typeof system?.content === 'string' ? system.content.length : 0,
          lastUserMessage: typeof lastHuman?.content === 'string' ? lastHuman.content : null,
          historyCount: flat.length - (system ? 1 : 0) - (lastHuman ? 1 : 0),
        },
        'LLM invoke',
      );
    }

    if (runId) {
      this.pending.set(llmRunId, { runId, model: replayPayload.model, request: replayPayload, startedAt: Date.now() });
    }
  }

  async handleLLMEnd(
    output: {
      generations: LlmGeneration[][];
      llmOutput?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } };
    },
    llmRunId: string,
  ): Promise<void> {
    const gen = output.generations?.[0]?.[0];
    const text = gen?.text;
    log.debug({ responseLength: text?.length ?? 0, response: text ?? null }, 'LLM response');

    const pending = this.pending.get(llmRunId);
    if (!pending) {
      return;
    }
    this.pending.delete(llmRunId);

    const usage = output.llmOutput?.tokenUsage;
    try {
      await this.recordCall({
        runId: pending.runId,
        model: pending.model,
        request: pending.request,
        response: {
          text: text ?? '',
          toolCalls: gen?.message?.tool_calls,
          finishReason: (gen?.generationInfo?.['finish_reason'] as string | undefined) ?? null,
          usage: usage
            ? { promptTokens: usage.promptTokens ?? 0, completionTokens: usage.completionTokens ?? 0 }
            : null,
        },
        latencyMs: Date.now() - pending.startedAt,
      });
    } catch (err) {
      log.error({ err, runId: pending.runId }, 'Failed to record the model call — continuing');
    }
  }

  async handleLLMError(err: unknown, llmRunId: string): Promise<void> {
    const pending = this.pending.get(llmRunId);
    if (!pending) {
      return;
    }
    this.pending.delete(llmRunId);

    const { errorClass, errorMessage } = classifyError(err);
    try {
      await this.recordCall({
        runId: pending.runId,
        model: pending.model,
        request: pending.request,
        response: null,
        latencyMs: Date.now() - pending.startedAt,
        errorClass,
        errorMessage,
      });
    } catch (recordErr) {
      log.error({ err: recordErr, runId: pending.runId }, 'Failed to record the failed model call — continuing');
    }
  }
}
