# ADR-0008 Implementation Summary

**Date:** 2026-02-15  
**Status:** ✅ COMPLETED (Application Code — Phases 2-3)

---

## What Was Implemented

### Phase 2: Logging Infrastructure & Code Cleanup

#### ✅ 2a. Shared Logger Factory
- **File:** `apps/server/src/shared/logger.ts`
- Created `rootLogger` (Pino singleton) with:
  - Automatic redaction of sensitive fields (passwords, tokens, API keys)
  - Per-module log level overrides via `LOG_LEVEL_<MODULE>` env vars
  - `pino-pretty` in development, JSON in production
- Exported `createLogger(module)` for all layers (domain, infra, app, main)
- Exported `Logger` type for DI

#### ✅ 2b. LOG_LEVEL Configuration
- **File:** `apps/server/src/config/index.ts`
- Added `LOG_LEVEL` to `EnvSchema` with default `'info'`
- **File:** `apps/server/.env`
- Set `LOG_LEVEL=debug` for development

#### ✅ 2c. Fastify Logger Integration
- **File:** `apps/server/src/app/server.ts`
- Replaced Fastify's built-in logger with `rootLogger` via `logger: rootLogger`
- Now `app.log`, `req.log`, and `createLogger('module')` share the same Pino instance

#### ✅ 2d. LLM Service Cleanup
- **File:** `apps/server/src/infra/ai/llm.service.ts`
- Replaced all 30+ `console.log`/`console.error` with structured Pino logs
- **Development mode:** logs full content (prompts, messages, responses, conversation history)
- **Production mode:** logs only metadata (lengths, token counts, latency)
- Removed debug infrastructure:
  - In-memory `requestHistory`/`responseHistory`
  - `getDebugInfo()`, `enableDebugMode()`, `disableDebugMode()`, `clearHistory()`
  - `LLM_DEBUG` env var
- **File:** `apps/server/src/domain/ai/ports.ts`
- Removed debug methods from `LLMService` interface
- Added `log?: Logger` to `generateWithSystemPrompt()` and `generateStructured()`
- **File:** `apps/server/src/app/routes/chat.routes.ts`
- Deleted debug endpoints: `GET /api/debug/llm`, `POST /api/debug/llm/clear`

#### ✅ 2e. Bot Logging
- **File:** `apps/bot/package.json`
- Added `pino@^9.9.0` and `pino-pretty@^13.1.1`
- **File:** `apps/bot/logger.ts` (new)
- Created bot-specific logger with `module: 'bot'`
- **File:** `apps/bot/handlers.ts`
- Replaced all `console.log`/`console.error` with structured Pino logs
- Logs include: `username`, `chatId`, `textLength`, `status`, `responseData`

#### ✅ 2f. Seed Script Logging
- **File:** `apps/server/src/infra/db/seeds/exercises.seed.ts`
- Replaced `console.log` with `createLogger('seed')`
- Structured logs: `{ count, name, category }`

#### ✅ 2g. Error Handler Improvements
- **File:** `apps/server/src/app/middlewares/error.ts`
- Changed signature: `(err, _req, reply)` → `(err, req, reply)`
- Added logging for ALL error types:
  - **Validation errors (400):** `req.log.warn({ err, statusCode: 400, code: 'VALIDATION_ERROR' })`
  - **Fastify errors (4xx):** `req.log.warn({ err, statusCode, code })`
  - **AppError (business errors):** `req.log.warn({ err, statusCode, code })`
  - **Unknown errors (500):** `req.log.error({ err }, 'unhandled error')`
- Uses `req.log` (with `reqId`) instead of `app.log`

### Phase 3: Context Propagation (reqId, userId)

#### ✅ 3a. Domain Service Interfaces
- **File:** `apps/server/src/domain/user/ports/service.ports.ts`
- Added `opts?: { log?: Logger }` to:
  - `IRegistrationService.processUserMessage()`
  - `IChatService.processMessage()`

#### ✅ 3b. Service Implementations
- **File:** `apps/server/src/domain/user/services/registration.service.ts`
- Accepts `opts?: { log?: Logger }`, passes to `llmService.generateWithSystemPrompt(..., { log })`
- **File:** `apps/server/src/domain/user/services/chat.service.ts`
- Accepts `opts?: { log?: Logger }`, passes to both:
  - `llmService.generateStructured(..., { log })`
  - `llmService.generateWithSystemPrompt(..., { log })`

#### ✅ 3c. Route Handlers
- **File:** `apps/server/src/app/routes/chat.routes.ts`
- Registration flow:
  ```typescript
  const log = req.log.child({ userId, phase: 'registration' });
  await registrationService.processUserMessage(user, message, historyMessages, { log });
  ```
- Chat flow:
  ```typescript
  const log = req.log.child({ userId, phase });
  await chatService.processMessage(user, message, phase, historyMessages, { log });
  ```

---

## Logging Strategy (Development vs Production)

| What | Development | Production |
|------|-------------|------------|
| **LLM prompts** | Full content | Length only |
| **LLM responses** | Full content | Length only |
| **User messages** | Full content | Length only |
| **Conversation history** | Full array | Count only |
| **Metadata** | Always logged | Always logged |
| **Token usage** | Always logged | Always logged |
| **Latency** | Always logged | Always logged |
| **Errors** | Full stack trace | Full stack trace |

**Rationale:** Development needs full context for debugging; production avoids logging PII (user health data, personal info) per GDPR/privacy requirements (LOGGING_GUIDE.md).

---

## Key Architectural Decisions

1. **Shared `rootLogger` singleton** — Cross-cutting concern exception to "no shared singletons" rule (ADR-0008)
2. **Labels strategy for Loki** — Only `service`, `level`, `module` are indexed; high-cardinality fields (`userId`, `reqId`) stay in JSON body
3. **Framework-agnostic logging** — Domain services accept `Logger` interface, not Fastify dependency
4. **Automatic redaction** — Pino redacts `*.password`, `*.apiKey`, `*.token`, `req.headers.authorization`, etc.
5. **Per-module log levels** — `LOG_LEVEL_LLM=debug LOG_LEVEL=info` enables debug only for LLM module

---

## Files Changed

### Created
- `apps/server/src/shared/logger.ts` (rootLogger + createLogger)
- `apps/bot/logger.ts` (bot-specific logger)

### Modified (Server)
- `apps/server/src/config/index.ts` (LOG_LEVEL in schema)
- `apps/server/.env` (LOG_LEVEL=debug, removed LLM_DEBUG)
- `apps/server/src/app/server.ts` (Fastify logger integration)
- `apps/server/src/app/middlewares/error.ts` (log all errors)
- `apps/server/src/app/routes/chat.routes.ts` (context propagation, removed debug endpoints)
- `apps/server/src/domain/ai/ports.ts` (removed debug methods, added Logger)
- `apps/server/src/domain/user/ports/service.ports.ts` (added Logger to interfaces)
- `apps/server/src/domain/user/services/registration.service.ts` (accept & pass log)
- `apps/server/src/domain/user/services/chat.service.ts` (accept & pass log)
- `apps/server/src/infra/ai/llm.service.ts` (full rewrite: Pino, dev/prod strategy, removed debug)
- `apps/server/src/infra/db/seeds/exercises.seed.ts` (Pino logs)

### Modified (Bot)
- `apps/bot/package.json` (added pino dependencies)
- `apps/bot/handlers.ts` (replaced console.* with Pino)

---

## Verification

### ✅ ESLint
```bash
cd apps/server && npx eslint src/ --quiet
# Exit code: 0 (no errors)
```

### ✅ No console.* in Production Code
```bash
rg 'console\.(log|error|warn|info)' apps/server/src apps/bot
# Only match: apps/server/src/domain/user/services/README-parser.md (documentation)
```

### ✅ All TODOs Completed
- [x] Phase 2a: Shared logger
- [x] Phase 2b: LOG_LEVEL config
- [x] Phase 2c: Fastify integration
- [x] Phase 2d: LLM service cleanup
- [x] Phase 2e: Bot logging
- [x] Phase 2f: Seed logging
- [x] Phase 2g: Error handler
- [x] Phase 3: Context propagation

---

## What's NOT in This Implementation

**Docker Infrastructure (Phase 1 from ADR-0008)** — separate task for DevOps:
- `docker-compose.yml` — add loki, alloy, grafana services
- `infra/loki/loki-config.yml`
- `infra/alloy/config.alloy`
- `infra/grafana/provisioning/datasources/loki.yml`

**Dashboards (Phase 4 from ADR-0008)** — after Phase 1 stabilization:
- Grafana dashboard: error rate, LLM latency, active users
- Alert rules for error spikes or LLM timeouts

---

## Testing the Implementation

### 1. Start the server
```bash
cd apps/server
LOG_LEVEL=debug npm run dev
```

### 2. Send a chat request
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "X-Api-Key: dev-key" \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-user","message":"hi"}'
```

### 3. Check logs
You should see structured JSON logs with:
- `module: "llm"`
- `reqId: "req-..."`
- `userId: "test-user"`
- `phase: "registration"` or `"chat"`
- Full prompt/response content (in development)
- Token usage, latency, model

### 4. Test per-module log level
```bash
LOG_LEVEL=info LOG_LEVEL_LLM=debug npm run dev
# Only LLM module logs at debug level, everything else at info
```

### 5. Test production mode
```bash
NODE_ENV=production LOG_LEVEL=info npm run dev
# Logs are JSON (no pino-pretty)
# Prompts/responses show only metadata (lengths, not content)
```

---

## LogQL Query Examples (for Phase 1)

Once Loki is deployed, these queries will work in Grafana Explore:

```logql
# All errors from server in last 1h
{service="fitcoach-server", level="error"}

# LLM requests slower than 5s
{service="fitcoach-server", module="llm"} | json | processingTime > 5000

# All activity for a specific user
{service="fitcoach-server"} | json | userId="user_abc123"

# Full request trace by requestId
{service=~"fitcoach.*"} | json | reqId="req-42"

# Error rate by module (metric query)
sum by (module) (rate({service="fitcoach-server", level="error"}[5m]))
```

---

## Next Steps

1. **Install bot dependencies:**
   ```bash
   cd apps/bot
   npm install
   ```

2. **Deploy Loki stack** (DevOps task):
   - Follow ADR-0008 Phase 1 instructions
   - Add loki, alloy, grafana to `docker-compose.yml`
   - Configure Alloy to collect Docker logs
   - Verify logs appear in Grafana

3. **Create Grafana dashboards** (Phase 4):
   - Error rate by module
   - LLM latency percentiles (p50, p95, p99)
   - Active users (distinct userId count)
   - Token usage over time

4. **Set up alerts:**
   - Error rate > 10/min
   - LLM latency p95 > 10s
   - LLM provider errors

---

## Compliance

✅ **ARCHITECTURE.md** — No `console.*` outside tests  
✅ **LOGGING_GUIDE.md** — Structured logs, no PII in production, error-first pattern  
✅ **ADR-0008** — Pino logger, shared logger factory, context propagation  
✅ **ESLint boundaries** — `shared` layer importable by all layers  
✅ **DI principles** — Logger passed via interfaces, not imported directly in domain  

---

**Implementation completed by:** AI Assistant  
**Review status:** Ready for code review
