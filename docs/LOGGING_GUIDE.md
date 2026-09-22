# Logging Guide

Practical guide to logging in the project. Describes what, how, and at what level to log so that errors provide full context while production stays clean.

Infrastructure setup (Grafana + Loki + Alloy) is described in [ADR-0008](adr/0008-centralized-logging-with-grafana-loki.md).

---

## Log Levels

Each level answers a different question. Everything below the current level is suppressed.

| Level | Pino (numeric) | Question | Default Environment |
|-------|---------------|----------|-------------------|
| `trace` | 10 | What is the code doing step by step? | Never by default |
| `debug` | 20 | What decisions is the system making? | development |
| `info` | 30 | What meaningful events happened? | **production** |
| `warn` | 40 | Something is wrong but the system handled it? | All |
| `error` | 50 | Did an operation fail? | All |
| `fatal` | 60 | Must the process stop? | All |

### trace — step-by-step diagnostics

Only for reproducing specific bugs. Enormous volume, never enable in production by default.

```typescript
log.trace({ userId, phase, historyLength: history.length }, 'processMessage called');
log.trace({ rawFields: Object.keys(parsed), validFields: validated.length }, 'LLM response fields validated');
log.trace({ table: 'users', where: { id: userId } }, 'query params');
```

### debug — decisions and metadata

Information a developer needs during active debugging. Shows "why" the system took a particular path.

```typescript
// LLM: request metadata (NOT content)
log.debug({ model, promptTokens: 450, temperature: 0.7, jsonMode: true }, 'LLM request prepared');
log.debug({ completionTokens: 230, latencyMs: 1842, finishReason: 'stop' }, 'LLM response received');

// Business logic: branching
log.debug({ userId, phase, hasTrainingCtx: true }, 'phase resolution');

// Retries
log.debug({ attempt: 2, maxRetries: 3, backoffMs: 2000 }, 'retrying LLM call');
```

### info — business events (production default)

Each info entry is a completed action or significant state change. Rule of thumb: if you want to count it on a dashboard — it's info.

```typescript
// Request lifecycle
log.info({ method: 'POST', path: '/api/chat', userId }, 'request started');
log.info({ statusCode: 200, durationMs: 2340 }, 'request completed');

// Business events
log.info({ userId, from: 'registration', to: 'plan_creation' }, 'phase transition');
log.info({ userId, planId, exerciseCount: 5, totalSets: 15 }, 'training plan created');
log.info({ userId }, 'user registration completed');

// External services (summary only)
log.info({ model: 'gpt-4o', latencyMs: 1842, totalTokens: 680 }, 'LLM call completed');

// Process lifecycle
log.info({ port: 3001, env: 'production' }, 'server started');
```

### warn — degradation, but system is working

Each warn should be potentially actionable. System degraded gracefully, but the situation could become an error.

```typescript
log.warn({ err, userId, phase }, 'failed to append conversation turn — response not affected');
log.warn({ tokenCount: 14200, limit: 16000, model }, 'prompt approaching token limit');
log.warn({ userId, field: 'age', value: -5 }, 'LLM returned invalid field value, using default');
```

### error — operation failed

Must contain enough context to begin debugging **without searching for other logs**.

```typescript
log.error({ err, model, promptTokens, attempt: 3 }, 'LLM call failed after retries');
log.error({ err, query: 'getUserById', userId }, 'database query failed');
log.error({ err, userId, from: phase, to: toPhase }, 'phase transition failed');
```

### fatal — process cannot continue

After fatal, `process.exit(1)` should follow. There should be very few such points in the codebase.

```typescript
log.fatal({ err, port }, 'server failed to bind to port');
log.fatal({ err }, 'database connection failed on startup');
```

---

## Mandatory Context

Each log entry should answer: "If I only had this one line — can I start debugging?"

### Automatic fields (Pino)

| Field | Source | Example |
|-------|--------|---------|
| `time` | Pino | `1708012800000` |
| `level` | Pino | `30` |
| `pid` | Pino | `12345` |
| `hostname` | Pino | `fitcoach-server` |

### Module fields (child logger)

| Field | Source | Example |
|-------|--------|---------|
| `module` | `createLogger('llm')` | `"llm"` |

### Request fields (request-scoped child logger)

| Field | Source | Example |
|-------|--------|---------|
| `reqId` | Fastify `request.id` | `"req-1"` |
| `userId` | From request body / auth | `"user_abc123"` |
| `phase` | Business logic | `"plan_creation"` |

### Event fields (per log call)

| Field | When | Example |
|-------|------|---------|
| `err` | Any error | Error object |
| `durationMs` | Timed operations | `1842` |
| `statusCode` | HTTP responses | `200` |
| `model` | LLM calls | `"gpt-4o"` |
| `totalTokens` | LLM calls | `680` |

### Minimum context for debuggable error

```typescript
log.error({
  err,                                // WHAT failed (message + stack)
  reqId,                              // WHICH request
  userId,                             // WHO was affected
  module: 'llm',                      // WHERE in code
  operation: 'chat.processMessage',   // WHAT operation
  phase: 'plan_creation',             // WHAT state
  durationMs: 5200,                   // HOW LONG before failure
}, 'LLM call failed after retries');  // Human-readable summary
```

---

## 5 Questions for Error Logging

Every error log entry should answer five questions:

| Question | Field | Example |
|----------|-------|---------|
| **WHO** was affected? | `userId`, `reqId` | `userId: "user_abc123"` |
| **WHAT** failed? | `err.message`, `err.code` | `"Connection refused"` |
| **WHEN**? | `time` (auto) | Pino adds timestamp |
| **WHERE** in code? | `module`, `operation`, `err.stack` | `module: "llm"` |
| **WHY**? (input/state) | contextual fields | `model`, `attempt`, `phase` |

---

## Patterns

### Error-first in Pino

Always pass Error as `{ err }` in the first argument. Pino will automatically extract `message`, `stack`, `type`.

```typescript
// CORRECT: error in context, message separate
log.error({ err, userId, operation: 'processMessage' }, 'chat processing failed');

// WRONG: loses stack trace
log.error(`Error: ${err.message}`);

// WRONG: Pino ignores second argument object
log.error('chat processing failed', err);
```

### Enrichment at layer boundaries

When catching errors at a layer boundary — add context that the lower layer didn't have:

```typescript
// chat.routes.ts (HTTP boundary)
try {
  const result = await chatService.processMessage(userId, message, phase, history);
} catch (error) {
  req.log.error({
    err: error,
    userId,
    phase,
    messageLength: message.length,
    historyTurns: history.length,
    durationMs: Date.now() - startTime,
  }, 'chat processing failed');
}
```

### Expected vs unexpected errors

```typescript
if (err instanceof AppError) {
  // Expected: warn, business code
  req.log.warn({ err, statusCode: err.statusCode, code: err.code, userId }, 'app error');
} else {
  // Unexpected: error, full context
  req.log.error({ err, userId }, 'unhandled error');
}
```

### Log once at boundary

Log at the layer with maximum context (usually route handler or error handler), not at every layer.

```typescript
// WRONG: duplication
// In service:
log.error({ err }, 'LLM call failed');
// In route:
log.error({ err }, 'chat processing failed because LLM call failed');

// CORRECT: once at boundary with full context
req.log.error({ err, userId, phase, durationMs }, 'chat processing failed');
```

---

## LLM Call Logging

LLM calls are expensive, slow, and non-deterministic. Log enough for debugging and cost tracking, but never log user content.

### What to log

```typescript
// BEFORE call (debug)
log.debug({
  model,
  promptTokenEstimate: estimateTokens(messages),
  temperature,
  jsonMode: true,
  messageCount: messages.length,
  systemPromptTemplate: 'plan_creation_v2',  // template name, NOT content
}, 'LLM request prepared');

// AFTER call (info on success)
log.info({
  model,
  promptTokens: usage.prompt_tokens,
  completionTokens: usage.completion_tokens,
  totalTokens: usage.total_tokens,
  latencyMs: Date.now() - startTime,
  finishReason: response.finish_reason,
}, 'LLM call completed');

// ON ERROR (error)
log.error({
  err,
  model,
  promptTokenEstimate,
  attempt: 3,
  totalLatencyMs: Date.now() - firstAttemptTime,
  lastStatusCode: err.status,
}, 'LLM call failed after retries');
```

### What NOT to log

```typescript
// NEVER: raw prompt (may contain user PII)
log.debug({ prompt: systemPrompt + userMessage });

// NEVER: raw LLM response (may echo user PII)
log.debug({ response: completion.content });

// NEVER: API keys
log.debug({ apiKey: config.LLM_API_KEY });

// INSTEAD: structural metadata
log.debug({
  systemPromptTemplate: 'registration_v3',
  systemPromptLength: systemPrompt.length,
  userMessageLength: userMessage.length,
  responseLength: completion.content.length,
}, 'LLM interaction metadata');
```

---

## Breadcrumb Trail (request chain)

Goal: given any `reqId`, reconstruct the full request journey with one LogQL query:
```logql
{service="fitcoach-server"} | json | reqId="req-42"
```

Result:
```
INFO  reqId=req-42  processing chat message          userId=abc phase=plan_creation
DEBUG reqId=req-42  phase resolution                  hasTrainingCtx=false
DEBUG reqId=req-42  LLM invoke                        userId=abc totalMessages=12
DEBUG reqId=req-42  LLM response                      responseLength=340
INFO  reqId=req-42  Conversation run recorded         runId=... phase=chat model=z-ai/glm-5.3 tokensIn=450 tokensOut=180 latencyMs=1842
INFO  reqId=req-42  phase transition                  from=plan_creation to=session_planning
INFO  reqId=req-42  request completed                 statusCode=200 responseTime=2340ms
```

The graph path's per-run `info` event is "Conversation run recorded" (persist node) —
it carries runId, phase, model, promptVersions, tokensIn/Out, latencyMs, llmCalls.
The legacy `llm.service.ts` path (and its "LLM call completed" event) was deleted in
refactor P1 (2026-09); non-graph LLM calls now go through `infra/ai/llm.gateway.ts`,
which emits an `LLM gateway call` `info` event (profile, runId/jobId, latencyMs, kind).
LLM request/response content itself stays at `debug` (BUG-003 replay behaviour).

---

## The Durable Record vs. the Log (AC-AT-6)

**Pino logs (this whole document, so far) are ephemeral.** They go to stdout, Docker's
`json-file` driver captures up to 10 MB × 3 files per container, and that is it — the
log lines above are for debugging a live process, not for answering "what did we send
the model on 2026-09-21?" days later. **The authoritative record of every model
invocation lives in Postgres, in `llm_calls` (+ `prompt_blobs`), not in the log**, since
the LLM I/O Audit Trail plan (AC-AT-1..AC-AT-4). If you need to know what a run said,
sent, or received, query the database; treat a log line as a hint, never as the source.

### Why a `volumes:` mount cannot fix a lost container log

The plan that started this work assumed "no log volume is mounted" was why the
2026-09-21 09:25 deploy erased that morning's evidence, and that mounting one would fix
it. That premise was wrong, and it is corrected here so nobody rediscovers it by trying
the same fix: Docker's `json-file` driver (configured in `deploy/docker-compose.yml`'s
`logging:` block, 10m × 3 files, on every service) writes to
`/var/lib/docker/containers/<container-id>/<container-id>-json.log` — a path under
**dockerd's own data root, keyed by container id**. No `volumes:` entry in a compose
service can relocate it; a bind mount only reaches paths you name inside *that*
container's filesystem, and this file lives outside every container, managed by the
daemon. What actually erases the evidence is the deploy itself: `docker compose up -d`
recreates `server` and `bot` with **new** container ids, the **old** containers are
removed, and dockerd deletes the old id's log directory with them — evidence gone,
silently, the moment the recreate completes.

### The fix: capture before recreate, in `deploy.sh`

`deploy/deploy.sh` now captures each running service's current logs to a host file
**before** rebuilding and restarting containers — the same shape, and same place in the
script, as the existing database backup:

- **What**: `docker compose logs <service>` output — whatever `json-file` still has
  retained (up to the 30 MB rolling window) — for `server` and `bot`.
- **When**: right after the database backup, before `docker compose build`/`up -d`.
- **Where**: `${REPO_DIR}/logs/<env>/<service>_<timestamp>.log` on the VPS host (e.g.
  `/srv/docker/fitcoach/logs/dev/server_20260922_093000.log`) — a plain file, not a
  container volume; nothing container-side needs to change for this to work.
- **Failure mode**: a capture failure or a service that isn't running yet (first
  deploy) is logged and skipped — it never aborts the deploy, matching the DB backup's
  own guard.
- **Retention of the capture files themselves**: not automated by this plan: they are
  the "before we blew away the old container" snapshot, not a permanent log archive.
  Prune `${REPO_DIR}/logs/<env>/` by hand (or a future cron) if disk pressure calls for
  it.

### `llm_calls` retention (the durable record's own aging policy)

Unlike the ephemeral log capture above, `llm_calls` rows are never deleted — only the
heavy `request`/`response` JSON columns age out. Every other column — `run_id`,
`call_index`, `model`, `latency_ms`, `error_class`, `error_message`, `created_at`,
`prompt_hashes` — is kept forever, so "this run made this call, on this model, at this
time, taking this long, and it did or didn't fail" survives even after the payload is
gone.

- **What ages out**: `llm_calls.request` and `llm_calls.response` — nulled, not the row.
- **Window**: `LLM_CALLS_RETENTION_DAYS`, default **30** — a plain integer, days.
  Configured in `apps/server/src/config/index.ts` (`EnvSchema`), documented in
  `apps/server/.env.example`. To change it, set `LLM_CALLS_RETENTION_DAYS=<n>` in the
  environment's real `.env.<env>` file (never `.env.example` itself) and redeploy.
- **`prompt_blobs` ages out too, on the same "keep the row, drop the payload" rule —
  not "never pruned".** A first version of this guide claimed a blob is "one row per
  distinct prompt version, not per call" and left it alone entirely; that is true only
  of the one static rules block. `assemble-context.ts` pushes up to six `SystemMessage`s
  per call — per-profile, per-episode and per-workout blocks that change on nearly every
  call — and the recorder hashes every one of them into its own blob, so most blobs are
  NOT reusable across calls the way the static one is. Leaving them all forever would
  have moved the bulky, ever-changing context OUT of the column being pruned and INTO a
  table kept permanently — the opposite of retention. The fix: `llm_calls.prompt_hashes`
  (every hash a call's request referenced) is written once at record time and is NEVER
  nulled by the prune, so a blob's liveness stays a join away even after `request`
  itself is gone. Once no row whose `request` is still present references a hash any
  more, that blob's `content` is nulled — never the row (`hash`/`created_at` survive,
  so which prompt versions ever existed stays answerable). A blob referenced by both a
  pruned row and a still-live one keeps its content; sharing a hash never costs the live
  row its context. Content that comes back later (identical text hashes to the same key)
  is restored by the recorder's upsert, not left stuck null. See
  `apps/server/src/infra/db/scripts/prune-llm-calls.ts`'s header for the full reasoning.
- **How to run it**: `npm run db:prune-llm-calls` from `apps/server` — dry-run by
  default (counts what each of the two statements would drop, changes nothing); pass
  `-- --apply` to actually null the payloads, and `-- --days N` to override the
  configured window for one run. The `llm_calls` statement always runs before the
  `prompt_blobs` one — the blob pass depends on it. No in-app scheduler: install it as a
  nightly cron job on the host, the same operating model as `db:prune-checkpoints`.

---

## What to NEVER log

### Automatic redaction (Pino `redact`)

```typescript
const logger = pino({
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      '*.password',
      '*.apiKey',
      '*.token',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
});
```

### Forbidden data categories

| Category | Examples | Why |
|----------|---------|-----|
| Authentication | Passwords, API keys, JWT, session IDs | Leak if logs are exposed |
| PII | Email, phone, full name, address, DOB | GDPR/privacy |
| User LLM messages | Text user entered | Contains personal health data (fitness app) |
| LLM responses | Full response content | May echo user PII |
| Financial data | Card numbers, bank accounts | PCI-DSS |

---

## Structure vs strings

```typescript
// CORRECT: structured log, parseable by Loki/Grafana/LLM
log.info({ userId, exerciseCount: exercises.length }, 'training plan created');

// WRONG: string interpolation, not parseable
log.info(`User ${userId} created plan with ${exercises.length} exercises`);

// CORRECT: only needed fields
log.debug({ userId: user.id, planId: plan.id, phase: context.phase }, 'processing');

// WRONG: entire object (noise, potential PII, perf)
log.debug({ user, plan, context, history }, 'processing');
```

---

## Log Level Configuration

### By environment

| Environment | Level | pino-pretty | Reason |
|-------------|-------|-------------|--------|
| development | `debug` | Yes | Developer needs decisions and LLM metadata |
| test | `warn` | No | Tests should be quiet |
| production | `info` | No (JSON to stdout) | Business events, requests, LLM summaries |

### Per-module (env variables)

```bash
# Production: everything at info, but LLM module at debug for investigation
LOG_LEVEL=info LOG_LEVEL_LLM=debug node dist/main.js

# Development: everything at debug, but DB at trace
LOG_LEVEL=debug LOG_LEVEL_DB=trace node dist/main.js
```

Implementation:

```typescript
// src/shared/logger.ts
const MODULE_LEVELS: Record<string, string> = {};

for (const [key, value] of Object.entries(process.env)) {
  const match = key.match(/^LOG_LEVEL_(.+)$/);
  if (match && value) {
    MODULE_LEVELS[match[1].toLowerCase()] = value;
  }
}

export function createLogger(module: string) {
  const child = rootLogger.child({ module });
  const moduleLevel = MODULE_LEVELS[module];
  if (moduleLevel) {
    child.level = moduleLevel;
  }
  return child;
}
```

---

## Loki: Labels vs JSON

Critical rule for Loki performance: labels create streams. High cardinality = degradation.

| Label (low cardinality) | In JSON body (high cardinality) |
|------------------------|--------------------------------|
| `service` (fitcoach-server, fitcoach-bot) | `reqId` (unique per request) |
| `level` (info, warn, error, ...) | `userId` (grows with users) |
| `module` (llm, chat, training, user) | `durationMs`, `statusCode`, `model` |
| `environment` (dev, test, prod) | `phase`, `operation` |

Rule: add a label only if you'll **frequently** filter by it in stream selector `{...}`. Everything else goes in JSON, extracted via `| json`.

---

## Useful LogQL Queries

```logql
# All server errors in last hour
{service="fitcoach-server", level="error"}

# Full request trace by reqId
{service=~"fitcoach.*"} | json | reqId="req-42"

# All activity for specific user
{service="fitcoach-server"} | json | userId="user_abc123"

# Slow LLM calls (> 5 seconds)
{service="fitcoach-server", module="llm"} |= "LLM call completed" | json | latencyMs > 5000

# Error rate by module over 5 minutes
sum by (module) (rate({service="fitcoach-server", level="error"}[5m]))

# Phase transitions
{service="fitcoach-server"} |= "phase transition" | json

# Export JSON for LLM analysis
{service="fitcoach-server", level="error"} | json | line_format "{{.msg}} {{.err}}"
```

---

## Infrastructure Setup

### Loki Stack Location

Docker Compose stack (Loki + Alloy + Grafana) is in `/Users/filko/Docker/loki_stack`:

```bash
cd /Users/filko/Docker/loki_stack
docker-compose up -d
```

**Grafana UI**: http://localhost:3030 (anonymous admin access enabled)

### Connecting FitCoach Containers

Add to project's `docker-compose.yml`:

```yaml
services:
  server:
    # ... existing config ...
    labels:
      service: "fitcoach-server"
    networks:
      - default
      - loki

  bot:
    # ... existing config ...
    labels:
      service: "fitcoach-bot"
    networks:
      - default
      - loki

networks:
  loki:
    external: true
    name: loki_loki-net
```

Alloy automatically discovers labeled containers and ships their stdout JSON logs to Loki.

### Verifying Integration

```bash
# Check Alloy discovered containers
docker logs fitcoach-alloy 2>&1 | grep discovered

# Verify Loki receives logs
curl http://localhost:3100/ready
```

In Grafana Explore, run:
```logql
{service=~"fitcoach.*"}
```
