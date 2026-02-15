# ADR-0008: Centralized Logging with Grafana + Loki

## Status: PROPOSED

## Date: 2026-02-15

## Context

### Current State

The project has **Pino 9.9.0** as its logger, configured in `app/server.ts`:

```typescript
logger: {
  level: 'info',
  transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
}
```

This gives us structured JSON logs in production and pretty-printed output in development. However, there are several problems:

### Problem 1: No Centralized Log Storage and Search

Logs go to stdout and disappear. There is no way to:
- Search logs after the fact (e.g., "show me all errors for user X in the last hour")
- Correlate a chain of events across a single request (HTTP -> domain -> LLM -> DB)
- View historical trends (error rate over time, slow LLM responses)
- Set up alerts for critical errors

### Problem 2: Inconsistent Logging Across Codebase

- **`llm.service.ts`** (lines 176-348): 30+ `console.log`/`console.error` calls with `// eslint-disable-next-line no-console` suppressions. Debug output is unstructured plain text (`=== LLM REQUEST ===`), not JSON.
- **`apps/bot/handlers.ts`** (lines 37, 62, 68-75, 100, 106-113): `console.log`/`console.error` for message tracing and error reporting. No structure, no correlation with server-side logs.
- **`app/middlewares/error.ts`** (line 56): Uses `app.log.error(err)` correctly, but only for unhandled 500 errors. Known `AppError` cases (400, 404, etc.) are not logged at all.
- **ARCHITECTURE.md** (line 164): States "Do not use `console.*` outside tests" but this rule is violated in production code.

### Problem 3: No Request Correlation

Fastify generates a `request.id` automatically, but it is never propagated to domain or infra layers. When `LLMService` logs a request, there is no way to trace it back to the originating HTTP request or user.

### Problem 4: LLM Observability Gap

The LLM service maintains an in-memory `requestHistory`/`responseHistory` (max 100 entries) and debug endpoints (`GET /api/debug/llm`). This is:
- **Volatile**: lost on restart
- **Incomplete**: only captured when `LLM_DEBUG=true`
- **Not queryable**: no filtering, no aggregation, no time range
- **Unstructured**: `console.log` output is not parseable by log aggregation systems

### Requirements for a Logging System

1. **Simple to deploy**: Docker Compose addition, not a separate infrastructure project
2. **Low resource usage**: This is a solo/learning project; the logging stack shouldn't consume more resources than the app itself
3. **Structured log ingestion**: Must handle Pino's JSON natively without transformation pipelines
4. **Fast error analysis**: Filter by level, userId, requestId, phase, module within seconds
5. **LLM-friendly output**: Query results should return clean JSON that can be pasted into an LLM for analysis (no HTML, no proprietary formats)
6. **Free and open-source**: No per-user or per-GB limits

---

## Considered Options

### Option A: Grafana + Loki + Alloy

**Architecture:**
```
Fastify (Pino JSON stdout) ─┐
                             ├─→ Alloy (log collector) ─→ Loki (storage) ─→ Grafana (UI/query)
Bot (Pino JSON stdout) ─────┘
```

- **Loki** stores logs indexed only by labels (service, level, environment), not by full text. This makes it extremely lightweight compared to Elasticsearch.
- **Alloy** (formerly Promtail) tails log files or Docker stdout, adds labels, ships to Loki.
- **Grafana** provides Explore UI for ad-hoc queries and dashboards for monitoring.

**Pros:**
- Pino JSON → Loki ingestion with zero transformation
- LogQL queries return JSON, ideal for LLM analysis
- ~200 MB RAM total (Loki + Alloy + Grafana) vs 2-4 GB for ELK
- Same Grafana can later add Prometheus (metrics) and Tempo (traces)
- 100% open-source (AGPLv3 for Grafana, Apache 2.0 for Loki)
- Mature ecosystem, extensive documentation

**Cons:**
- LogQL is a new query language to learn (simpler than PromQL, but not SQL)
- Loki is not a full-text search engine; complex text searches are slower than Elasticsearch
- Three services to configure (though docker-compose templates are readily available)

### Option B: ELK (Elasticsearch + Logstash + Kibana)

**Pros:**
- Full-text search with powerful Lucene queries
- Kibana has rich visualization capabilities
- Industry standard with massive community

**Cons:**
- **Elasticsearch alone requires 2-4 GB RAM minimum** — more than the entire app
- Complex configuration (JVM tuning, index lifecycle management)
- Logstash requires pipeline configuration for JSON parsing
- Overkill for a solo project with moderate log volume
- Kibana queries don't export cleanly for LLM analysis

### Option C: Seq (Datalust)

**Pros:**
- Single container, built-in UI, SQL-like queries
- Excellent structured log support
- Very fast for small-to-medium volumes

**Cons:**
- **Not fully open-source** — free tier limited to 1 user (development license)
- .NET ecosystem focus; Node.js support is via HTTP API (works, but not first-class)
- No path to add metrics/traces in the same system
- Vendor lock-in risk

### Option D: SigNoz

**Pros:**
- Full observability (logs + metrics + traces) in one platform
- OpenTelemetry-native
- Open-source (Enterprise Edition available)

**Cons:**
- **Heavy**: ClickHouse backend requires significant resources
- Complex initial setup for a "just logs" use case
- Steeper learning curve than Loki
- More moving parts than needed at current project scale

---

## Decision

### Adopt Grafana + Loki + Alloy (Option A)

Grafana + Loki is the best fit for the project's constraints:

| Requirement | How Loki Addresses It |
|---|---|
| Simple deployment | 3 services in docker-compose, pre-built configs |
| Low resources | ~200 MB RAM total, no JVM, no full-text indexing |
| Structured ingestion | Pino JSON → Alloy → Loki with label extraction |
| Fast error analysis | `{level="error"} \| json \| userId="abc"` returns results in <1s |
| LLM-friendly | LogQL output is JSON; copy-paste into any LLM context |
| Free/open-source | No limits on users, volume, or retention |

### Implementation Plan

The implementation is split into two independent tracks that can be done in any order:

#### Track 1: Infrastructure — Docker Compose for Loki Stack

Add Loki, Alloy, and Grafana to the existing `docker-compose.yml`:

```yaml
services:
  # ... existing db service ...

  loki:
    image: grafana/loki:3.4
    container_name: fitcoach-loki
    restart: unless-stopped
    ports:
      - '3100:3100'
    volumes:
      - loki-data:/loki
      - ./infra/loki/loki-config.yml:/etc/loki/local-config.yaml
    command: -config.file=/etc/loki/local-config.yaml

  alloy:
    image: grafana/alloy:latest
    container_name: fitcoach-alloy
    restart: unless-stopped
    volumes:
      - ./infra/alloy/config.alloy:/etc/alloy/config.alloy
      - /var/run/docker.sock:/var/run/docker.sock:ro
    command: run /etc/alloy/config.alloy
    depends_on:
      - loki

  grafana:
    image: grafana/grafana:11.5
    container_name: fitcoach-grafana
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_AUTH_ANONYMOUS_ENABLED: 'true'
      GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
    volumes:
      - grafana-data:/var/lib/grafana
      - ./infra/grafana/provisioning:/etc/grafana/provisioning
    depends_on:
      - loki

volumes:
  # ... existing pgdata ...
  loki-data:
  grafana-data:
```

**Config files to create:**

```
infra/
  loki/
    loki-config.yml        # Retention policy, storage, schema
  alloy/
    config.alloy           # Docker log discovery, label extraction, Loki push
  grafana/
    provisioning/
      datasources/
        loki.yml           # Auto-provision Loki as datasource
```

**Alloy config** — collect Docker container logs, extract Pino JSON fields as labels:

```alloy
// Discover Docker containers with label logging=true
discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
}

// Relabel: extract container name as service label
discovery.relabel "containers" {
  targets = discovery.docker.containers.targets
  rule {
    source_labels = ["__meta_docker_container_name"]
    target_label  = "service"
  }
}

// Collect logs from discovered containers
loki.source.docker "containers" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.relabel.containers.output
  forward_to = [loki.process.json_extract.receiver]
}

// Parse Pino JSON, extract key fields as labels
loki.process "json_extract" {
  stage.json {
    expressions = {
      level     = "level",
      module    = "module",
      requestId = "reqId",
      userId    = "userId",
    }
  }
  stage.labels {
    values = {
      level     = "",
      module    = "",
    }
  }
  forward_to = [loki.write.local.receiver]
}

// Ship to Loki
loki.write "local" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```

#### Track 2: Application Code — Logging Improvements

##### 2a. Replace `console.*` with Pino child loggers

Create a module-aware logger factory that domain/infra services can use without importing Fastify:

```typescript
// src/shared/logger.ts
import pino from 'pino';
import { loadConfig } from '@config/index';

const config = loadConfig();

export const rootLogger = pino({
  level: config.LOG_LEVEL ?? 'info',
  transport: config.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
});

export function createLogger(module: string) {
  return rootLogger.child({ module });
}
```

**Usage in LLMService** (replaces all `console.log`/`console.error`):
```typescript
import { createLogger } from '@shared/logger';

export class LLMService implements ILLMService {
  private log = createLogger('llm');

  // Instead of:  console.log('\n=== LLM REQUEST ===');
  // Use:         this.log.debug({ requestId, model, jsonMode, httpPayload }, 'LLM request');

  // Instead of:  console.error('LLM Provider Error:', providerError);
  // Use:         this.log.error({ requestId, providerError, err }, 'LLM provider error');
}
```

**Usage in Bot** (replaces `console.log`/`console.error`):
```typescript
import { createLogger } from '@shared/logger'; // or a local pino instance

const log = createLogger('bot');

// Instead of:  console.log('Message', msg.from?.username, userText);
// Use:         log.info({ username: msg.from?.username, text: userText }, 'incoming message');
```

##### 2b. Propagate request context (requestId, userId)

Use Fastify's built-in `request.id` and propagate it through the service layer:

```typescript
// Option: pass logger via request context
// In routes, req.log already has reqId bound by Fastify.
// Pass req.log (or { reqId, userId }) to domain services.

// chat.routes.ts
const result = await chatService.processMessage(userId, message, {
  log: req.log.child({ userId }),
});
```

This approach keeps domain services framework-agnostic (they receive a Pino-compatible logger interface, not a Fastify dependency).

##### 2c. Add LOG_LEVEL to env config

```typescript
// config/index.ts — add to EnvSchema:
LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
```

##### 2d. Structured error logging in error handler

```typescript
// app/middlewares/error.ts — log all errors, not just 500s:
app.setErrorHandler((err, req, reply) => {
  if (err instanceof AppError) {
    req.log.warn({ err, statusCode: err.statusCode, code: err.code }, 'app error');
    // ...existing response logic...
  }
  // ...rest...
});
```

### Useful LogQL Queries (Reference)

After deployment, these queries will be available in Grafana Explore:

```logql
# All errors from server in last 1h
{service="fitcoach-server", level="error"}

# LLM requests slower than 5s
{service="fitcoach-server", module="llm"} | json | processingTime > 5000

# All activity for a specific user
{service="fitcoach-server"} | json | userId="user_abc123"

# Error rate by module (metric query)
sum by (module) (rate({service="fitcoach-server", level="error"}[5m]))

# Full request trace by requestId
{service=~"fitcoach.*"} | json | reqId="req-1"

# Export JSON for LLM analysis (pipe to jq or copy from Grafana)
{service="fitcoach-server", level="error"} | json | line_format "{{.msg}} {{.err}}"
```

### Key Architectural Choices

1. **Shared `rootLogger` in `src/shared/logger.ts`** — this is a pragmatic exception to the "no shared singletons" rule. Logging is a cross-cutting concern. Domain services get a child logger via `createLogger(module)` which adds the `module` label without importing Fastify.

2. **Labels strategy for Loki** — only `service`, `level`, and `module` are indexed as labels. High-cardinality fields (`userId`, `reqId`, `processingTime`) stay in JSON body and are queried with `| json | field="value"`. This keeps Loki's index small and performant.

3. **Alloy over Promtail** — Grafana Alloy is the successor to Promtail (which is in maintenance mode). Alloy uses a declarative config language and supports future additions (metrics scraping, trace collection) without adding another service.

4. **No application-level HTTP push to Loki** — logs go to stdout (Pino default), Alloy collects from Docker. This avoids adding an HTTP dependency to the app and follows the 12-factor app principle (treat logs as event streams).

---

## Consequences

### Positive

- **Persistent, searchable logs** — errors and request traces survive restarts and are queryable by any field
- **Zero code coupling** — the app writes to stdout; log collection is infrastructure-only
- **LLM-analyzable** — LogQL JSON output can be directly pasted into Claude/GPT for root cause analysis
- **Unified logging** — both server and bot logs end up in the same Grafana, correlatable by requestId
- **Extensible** — same Grafana instance can add Prometheus dashboards (API latency, error rates) and Tempo traces (LLM call chains) later
- **Eliminates `console.*` violations** — structured Pino logging across the entire codebase

### Negative

- **3 new Docker containers** — increases local `docker-compose up` footprint from 1 to 4 services (~200 MB RAM added)
- **LogQL learning curve** — new query syntax, though simpler than PromQL or Elasticsearch Query DSL
- **Config file maintenance** — Alloy and Loki configs must be kept in sync with app changes (new services, new labels)

### Risks

- **Docker socket access** — Alloy needs read access to `/var/run/docker.sock` to discover containers. This is standard for log collectors but grants container metadata visibility.
- **Log volume growth** — if LLM debug logs remain at `debug` level in production, storage could grow quickly. Mitigated by: Loki retention policy (default 30 days), and keeping production log level at `info`.

---

## Migration Path

### Phase 1: Infrastructure (no code changes)
1. Add Loki, Alloy, Grafana to `docker-compose.yml`
2. Create config files under `infra/`
3. Verify existing Pino JSON logs appear in Grafana

### Phase 2: Code Cleanup
1. Add `src/shared/logger.ts` with `createLogger()`
2. Replace `console.*` in `llm.service.ts` with structured Pino logs
3. Replace `console.*` in `apps/bot/handlers.ts`
4. Add `LOG_LEVEL` to env config schema
5. Improve error handler to log all error categories

### Phase 3: Context Propagation
1. Pass `req.log` (with bound `reqId`) to domain services
2. Add `userId` to log context in chat/registration routes
3. Add `phase`, `intent` to training-related logs

### Phase 4: Dashboards (optional, after stabilization)
1. Create a Grafana dashboard: error rate, LLM latency, active users
2. Set up alert rules for error spikes or LLM timeouts

---

*Author: AI Assistant*
