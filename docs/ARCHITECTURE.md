# Fit Coach Backend Architecture

This document is the single source of truth for the backend architecture. It exists to keep human and AI collaborators aligned, prevent accidental restructures, and ensure fast feature delivery with minimal friction.

The codebase has been successfully migrated to Fastify. All Express dependencies have been removed and the application now runs on Fastify with proper plugin architecture, dependency injection, and clean layering.

## Goals
- Fast iteration with predictable structure
- Strict layering and boundaries to avoid coupling
- Type-safe APIs with validated schemas and generated docs
- Minimal infra boilerplate for a solo/learning project

## Tech Stack (target)
- Runtime: Node.js, TypeScript
- Web framework: Fastify
- Validation: Zod (+ fastify-type-provider-zod)
- API docs: @fastify/swagger, @fastify/swagger-ui
- Logging: Pino (+ pino-pretty in dev)
- ORM: Drizzle ORM (PostgreSQL, pg/pgvector)
- Migrations: drizzle-kit
- Testing: Jest + supertest (or fastify.inject)

## High-level Module Layout

```
apps/server/src/
  app/                          # HTTP transport (Fastify adapters)
    routes/                     # Route handlers (thin controllers)
      chat.routes.ts            # Thin proxy to ConversationRunPort (DI token CONVERSATION_RUN_PORT_TOKEN)
    plugins/                    # Fastify plugins (routes, security, docs)
    middlewares/                # Error, logging, validation hooks
    server.ts                   # Builds Fastify instance (plugins, hooks, routes)
    types/                      # Fastify type declarations

  domain/                       # Business logic (framework-agnostic)
    user/
      ports/                    # One directory per domain; entry point is index.ts
        index.ts               # Re-exports for convenience
        repository.ports.ts    # Data access contracts (layer name allowed: one such contract)
        service.ports.ts       # Business logic contracts (layer name allowed: one such contract)
      services/
        user.service.ts        # User CRUD operations
        registration.validation.ts # Zod validators for registration fields (reused in tools)
    ai/
      ports/
        llm.gateway.ports.ts   # LlmGateway (chat, structured) — ADR-0013 §7; the only LLM port
        index.ts
      types.ts                 # ChatMsg — LlmGateway call type only; graph history is LangChain BaseMessages from the checkpointed `messages` channel (P4, ADR-0013 §3.1)
    conversation/
      tool-outcome.ts         # ToolOutcome/ToolReturn/ToolStateUpdate — pure tool contract (ADR-0013 §6; no runtime LangGraph)
      phases.ts               # ConversationPhase — the five phases (ADR-0013 §11)
      transitions.ts          # TRANSITION_MATRIX + evaluateTransition — pure domain rules (BR-CONV-015..018, ADR-0013 §4.3)
      events.ts               # PhaseTransitionCommitted event + TransitionHandler type (ADR-0013 §4.3)
      episode.ts              # EpisodeSummary schema/types, StoredEpisodeSummary, CompactReason, TokenBudget (ADR-0013 §3.3)
      errors.ts                # LlmUnavailableError/ThreadBusyError/CoreError + HTTP_STATUS_BY_CODE (D-B, ADR-0013 §6) — typed errors the adapter throws and chat.routes.ts maps to 503/409/500
      ports/
        transcript.ports.ts   # TranscriptPort (appendRunMessages, appendSystemNote) + TranscriptMessage — transcript projection (§8)
        summary.ports.ts      # SummaryPort (insert, latestLegacySummary) — conversation_summaries (§8)
        conversation-run.ports.ts      # IConversationRunService (run rows, §8) + ConversationRunPort (§11 — run the graph, clearContext; token CONVERSATION_RUN_PORT_TOKEN)
        index.ts               # Re-exports (incl. ConversationPhase, and errors.ts's exports)
    training/
      ports/                   # Named by contract (rule 2)
        index.ts               # Re-exports
        embedding.ports.ts     # IEmbeddingService
        exercise.ports.ts      # IExerciseRepository, ExerciseSearchFilters
        workout-plan.ports.ts  # IWorkoutPlanRepository
        workout-session.ports.ts   # Session / session-exercise / session-set repositories
        training-service.ports.ts  # ITrainingService + result types (standing exception, rule 3)
      services/
      types.ts                 # Training DTOs (SessionSet.setData inferred from set-data.types.ts Zod)
      set-data.types.ts        # Zod schemas for set_data — single source of truth for the SetData union

  infra/                        # Integrations + drivers
    conversation/
      keyed-mutex.ts            # createKeyedMutex({ waitMs }) — generic per-key in-process mutex; a waiter that can't start within waitMs rejects with ThreadBusyError (D-12)
      with-run-mutex.ts         # withRunMutex(port, opts) — decorator around ConversationRunPort serialising run/clearContext per userId (D-A, ADR-0013 §6/§11); composed in register-infra-services.ts
    db/
      schema.ts                 # Drizzle schema (users, user_accounts, conversation_turns, etc.)
      drizzle.ts                # Pool + drizzle init + health
      repositories/             # Thin data access
        user.repository.ts
        exercise.repository.ts  # Includes searchByEmbedding() for vector search
        workout-plan.repository.ts
    ai/
      model.factory.ts          # Single ChatOpenAI construction site (getModel(profile), AC-1313)
      llm.gateway.ts            # OpenAiLlmGateway — LlmGateway port implementation (ADR-0013 §7 D-10)
      llm-log-handler.ts        # LLM boundary callback: debug logging only (run metrics live in the per-run collector)
      run-metrics.ts            # RunMetricsCollector — per-run instance carried in run context (ADR-0013 §8; no module state, AC-1331)
      embedding.service.ts      # Local all-MiniLM-L6-v2 via @huggingface/transformers (ONNX)
      embedding-text.util.ts    # buildEmbeddingText() — composite text for exercise embeddings
      graph/
        conversation.graph.ts   # Main StateGraph: prepare→route→<phase>→commit (ADR-0013 §4.1)
        state.ts                # ConversationState (durable, checkpointed) + RunContext (caller-provided, never checkpointed) + ctxOf accessor (ADR-0013 §3.2)
        phase-spec.ts           # PhaseSpec — one declarative spec per phase (INV-LLM-005)
        phase-subgraph.factory.ts  # buildPhaseSubgraph(spec) — the single factory building every phase subgraph
        phases/                 # The five PhaseSpecs: registration, chat, plan-creation, session-planning, training
        episode.ts              # splitEpisode (history vs current, D-I), lastAiText, toTranscriptMessages
        conversation-run.adapter.ts  # ConversationRunPort adapter: loads the user, builds run context, records failed runs, clearContext via the checkpointer (D-F)
        tool-executor.ts        # Shared tool executor: runs every phase's tool calls, answers every tool_call id, serialises ToolOutcome v1, applies ToolStateUpdate (ADR-0013 §4.2/§4.4/§6)
        tool-policy.ts          # ToolPolicy + pure helpers: ordering, batch dedup, search key (AC-1331/AC-1332)
        nodes/
          agent.node.ts             # Shared agent node: system split, post-tool nudge, empty-reply retry (replaces the five subgraphs)
          prepare.node.ts           # pendingTransition reset, episode compaction, training short-circuits → commit, registration↔chat sync
          route.node.ts             # Phase dispatch to the subgraph factory
          commit.node.ts            # transcript projection + run row + evaluateTransition + PhaseTransitionCommitted handlers (§4.1/§4.3; messages are never cleared)
          finalize.node.ts          # Returns {} (the reply is the last AIMessage in state)
          compact.ts                # Pure compaction rules: decideCompactReason, planCompaction (turn-safe cut), short-episode check, transcript rendering
          compact.node.ts           # buildCompactStep: summarises the ended episode via LlmGateway.structured, keeps max 3 summaries, RemoveMessage trim (BR-LLM-001..004)
        handlers/
          session-lifecycle.handler.ts      # TransitionHandler: training session completion, activeSessionId clearing
          compaction-flag.handler.ts        # TransitionHandler: sets compactReason = 'phase_boundary' on a committed transition
      tools/                        # One file per tool (ADR-0013 §11); tools return ToolReturn, never touch LangGraph
        outcome.ts                   # ToolOutcome serialisation v1: toToolMessage, outcomeKindOf, LLM/SYSTEM_ERROR prefixes
        index.ts                     # buildSharedTools + per-tool builder re-exports
        save-profile-fields.tool.ts / complete-registration.tool.ts
        update-profile.tool.ts / request-transition.tool.ts
        save-workout-plan.tool.ts / start-training-session.tool.ts
        log-set.tool.ts / complete-current-exercise.tool.ts / finish-training.tool.ts
        delete-last-sets.tool.ts / update-last-set.tool.ts
        search-exercises.tool.ts / timezone.tool.ts
        format-exercise-summary.ts   # Shared training summary helper + session constants
      messages/                      # User-facing message catalog (ADR-0013 §11) — en/ru, language_code driven
        catalog.ts / en.ts / ru.ts / index.ts
      context/                      # Context assembler — message order + token accounting (ADR-0013 §3.4)
        assemble-context.ts         # assembleContext() → { messages, budgetReport }: block 1 system → block 2 episode summaries → block 3 domain blocks → history → current (one shape for every phase); calls resolveBudget
        budget.ts                   # resolveBudget/trimHistory — INV-LLM-004 order: trim history → step block depths → drop oldest summary → D-D floor (block 1 never cut; `system` over budget only reported)
        token-estimator.ts          # estimateTokens + estimateMessages + TOKEN_ESTIMATOR_ID — the single estimator (app + eval stack)
      prompts/                       # Versioned prompt modules — every model-facing string (ADR-0013 §5)
        types.ts                     # Section, DirectiveModule, PromptModule<TCtx>, PhasePromptEntry
        compose.ts                   # renderDirectives, compose (join '\n\n'), sectionText, promptVersionsOf
        index.ts                     # Registry: PHASE_PROMPTS, STANDALONE_PROMPTS, promptVersionsForPhase
        directives/                  # The nine directives, one versioned module each
          identity.v1.ts             #   FitCoach persona
          greeting.v1.ts             #   new-day greeting (driven by ctx.now, not the clock)
          language.v1.ts             #   reply language
          timezone.v1.ts             #   user timezone
          name-usage.v1.ts           #   name usage rules
          formatting.telegram.v1.ts  #   Telegram formatting (per ctx.client)
          time-reference.v1.ts       #   workout time reference
          output.v1.ts               #   plain-text output
          tool-reply.v1.ts           #   reply after every tool call + index.ts (DEFAULT_DIRECTIVES_V1 order)
        phases/                      # Phase system prompts — text identical to the pre-P2 builders
          registration/v1.ts         #   + index.ts (PhasePromptEntry, requiredSections)
          chat/v1.ts                 #   context/rules/tools/no_set_logging (BUG-009 guard)
          plan_creation/v1.ts        #
          session_planning/v1.ts     #
          training/v1.ts             #   DIRECTIVES_WITHOUT_IDENTITY_V1 (render helpers live in blocks/ since the context-budget plan)
          */v2.ts                    #   current for chat/plan_creation/session_planning/training: v1 minus the domain sections (now block 3); registration has no v2
        blocks/                      # Injected fragments that are neither phase prompt nor directive
          types.ts                   #   ContextBlock<D> (D-A): pure renderer over the phase's loaded data, optional `depths`
          index.ts                   #   renderBlocks/fullDepth + re-exports
          user-facts.v1.ts           #   ## User Facts block (ADR-0013 §3.4 block 2, budgeted on `longTerm`) — durable facts extracted at compaction
          episode-summaries.v1.ts    #   ## Previous episodes block — context, not data (numbers come from tools)
          post-tool-nudge.v1.ts      #   post-tool nudge (agent node retry)
          chat-context.v1.ts / client-profile.v1.ts / session-planning-*.v1.ts / training-workout-overview.v1.ts
                                     #   domain context blocks (ADR-0013 §3.4 block 3, D-B): one per moved v1 section, byte-equal at full depth; declared on PhaseSpec.contextBlocks
        summarizer/v1.ts             # Legacy end-of-phase summariser (not used by the graph since P4; kept with its snapshot tests)
        summarizer/v2.ts             # Episode summariser — structured EpisodeSummary from the rendered transcript (no previousSummary)
        summarizer/v3.ts             # current: v2 plus a typed `facts` array (category, fact, muscleGroup?) consumed by the compact step (P6)
    conversation/
      drizzle-transcript.service.ts             # TranscriptPort impl — projects run messages into conversation_turns (one row per message, run_id always set)
      drizzle-summary.service.ts                # SummaryPort impl — writes conversation_summaries + the mirrored `summary` turn row in one transaction
      drizzle-conversation-run.service.ts       # IConversationRunService impl — writes conversation_runs
    di/
      container.ts              # DI container with factory support + lazy initialization
    config/
      index.ts                  # Env loading + Zod validation

  shared/
    errors.ts                   # AppError and error helpers
    types.ts                    # Shared DTOs/utility types
```

Notes:
- Keep only one shared package. Prefer `packages/shared` if needed. Do not duplicate under `apps/shared`.
- Route handlers are thin controllers in `app/routes/`; domain services must not import Fastify.
- Repositories must remain thin (CRUD, simple joins). Business rules live in domain services.
- Fastify plugins encapsulate functionality and can be composed for different contexts.

## Clients
- Bots and any other clients are external applications that consume this API via HTTP only.
- No shared code or types between server and clients. Treat clients as out-of-repo.
- Protected endpoints require `X-Api-Key` per `docs/API_SPEC.md:1`.
- README is an overview; this document is authoritative for architecture decisions.

## Layering Rules
1) **app → domain; infra depends on domain.** Domain ports (repository/adapter interfaces) are declared in `domain/*/ports/` with modular organization. Port implementations live in `infra/*`. The domain does **not** import from `infra/*`.
2) Controllers call domain services via DI; do not use `new` inside controllers.
3) Repositories are injected into domain services via DI by ports (interfaces), not by concrete implementations.
4) Imports from `app/*` into `domain/*` and `infra/*` are forbidden. App must not import infra implementations (db/ai/repositories). Importing the DI container (`@infra/di/container`) for resolution is allowed; prefer resolving in composition/bootstrapping, but thin routes may resolve via container when necessary. Controllers interact exclusively through ports.
5) Transport DTOs live in `app/*` (schemas), domain types in `domain/*`, and DB models in `infra/db/schema`.

### Interface Organization Principles

This section is the single source of this rule. ADR-0002 records why the monolithic
`ports.ts` was split; its Decision section is historical and is not the current spec.

1. **Location.** Every domain port lives in `domain/<domain>/ports/`. No port file
   exists outside that directory — including sub-packages such as `graph/`.
   **Exception, and its limit:** a contract that cannot yet satisfy the domain's
   dependency invariants is *not* relocated into `ports/` merely to satisfy this rule —
   the move would plant the violation in the surface reserved for clean contracts. It
   stays where it is, and the exception names the ADR or task that retires it. An
   exception without a named closing task is not allowed.
2. **Naming by contract, not by layer.** A file name answers "a contract for what":
   `embedding.ports.ts`, `conversation-run.ports.ts`, `workout-plan.ports.ts`.
   Layer names (`repository.ports.ts`, `service.ports.ts`) are allowed only while a
   domain has exactly one such contract; once there are several, split by meaning.
3. **Size is a signal, not a limit.** A port file holds one contract. Exceeding the
   guide figures — an interface over ~7 methods, or a file over ~80 lines — does **not**
   block on its own; it obliges a review, whose outcome is recorded next to the port:
   - *Is all of it used?* A method with no call sites is dead code — delete it, do not
     carry it along.
   - *Is it all in the right place?* If the methods fall into groups called by different
     consumers, several APIs share one contract — separate them.
   - *One reason to change?* Groups with different reasons to change are different
     contracts.

   The review ends in exactly one of three outcomes: remove what is unused, split the
   contract, or record a justified exception naming the task or ADR that closes it.
   Silently exceeding the guide is not allowed; neither is splitting a file mechanically
   to satisfy a counter.
4. **One entry point.** Every `ports/` directory has an `index.ts` re-exporting its
   files, and imports always address the directory (`@domain/training/ports`).
   Importing a file past `index.ts` is forbidden and is enforced by ESLint.
5. **No flat `ports.ts`.** A single contract still gets a directory with an `index.ts`.

Standing exceptions (each names the task that closes it):

- `training/ports/training-service.ports.ts` — `ITrainingService`, 16 methods (four legacy
  LLM methods deleted in refactor P1). Rule 3 review done: two unused methods and a split
  by consumer were identified; decomposition by role is tracked in `docs/BACKLOG.md` (rule 3).

### Enforced by ESLint (import boundaries)
- Domain (`src/domain/**`): cannot import `@app/*`, `**/app/**`, `@infra/*`, `**/infra/**`.
- App (`src/app/**`): cannot import infra implementations: `@infra/db/**`, `@infra/ai/**` (DI container access allowed).
- Infra (`src/infra/**`): cannot import `@app/*`, `**/app/**`.
- See `apps/server/eslint.config.js:1` for rules. Violations fail lint.

## Dependency Injection
- DI tokens and port interfaces live in `domain/*/ports/` with modular organization (or a neutral `shared/core` if a port is shared across domains).
- **DI tokens are declared as `unique symbol` next to their corresponding port interfaces** in the same file (e.g., `USER_SERVICE_TOKEN` alongside `IUserService`).
- Port implementations are located in `infra/*` and registered in the composition root.
- App / controllers and routes depend only on ports and tokens, NOT on implementations.
- Request‑scoped dependencies are used only when transactions are needed; singletons by default.
- **Composition Root = `src/main/**`**: dependency assembly (implementation registration, container, config, and server startup) is performed in `src/main/**`. App layer does not import or resolve implementations from the container.
- **Import Strategy**: import domain contracts through the ports directory
  (`@domain/<domain>/ports`), never a file inside it — § Interface Organization
  Principles rule 4, enforced by ESLint.

### DI Container Implementation
- Container (`src/infra/di/container.ts`) supports both direct instance registration and factory-based lazy initialization.
- **Factory pattern**: `container.registerFactory(token, (container) => new Service(...))` allows lazy instantiation and access to other dependencies via the container parameter.
- **Lazy initialization**: Services registered with factories are instantiated only on first `container.get(token)` call, preventing circular dependencies and improving startup time.
- **Service registration order** (`src/main/register-infra-services.ts`):
  1. Transcript/Summary services (Drizzle-backed `TranscriptPort`/`SummaryPort`)
  2. UserRepository (Drizzle-backed)
  3. UserService (depends on UserRepository)
  4. TrainingService (depends on training repositories)
  5. WorkoutPlanRepository
  6. ExerciseRepository
  7. PostgresSaver checkpointer (LangGraph checkpoint storage)
  8. ConversationGraph (depends on all of the above)
- **Fastify decoration**: Services are decorated on Fastify app instance (`app.services.*`) for easy access in routes without manual DI resolution.

## Configuration
- Config layer lives under `apps/server/src/config/**` with alias `@config/*`.
- Load `.env` based on `NODE_ENV` (e.g., `.env`, `.env.test`, `.env.production`).
- `loadConfig()` validates env via Zod and exposes a typed `Env`.
- Allowed imports: app, domain, infra may import from `@config/*`.
- Config itself must not import from other layers (one‑way dependency: app/domain/infra → config).

## Composition Root (Main)
- Composition root lives under `apps/server/src/main/**`.
- Responsibilities:
  - Create DI container instance.
  - Register infra implementations with domain ports via `registerInfraServices(container, opts?)`.
  - Start Fastify server (`buildServer(container)`) and wire plugins/routes.
- Side‑effects (like DB schema ensure/migrations) are not executed by default on app start.
  - `registerInfraServices(container, { ensureDb: true })` may be used explicitly in integration setups.
- App layer does not import infra or the DI container implementation directly; dependencies are resolved in `main` and passed into app (as constructor/arguments) without crossing boundaries.

## HTTP Plugins & Security
- Docs & Static: exposed via `docs.plugin.ts` (Swagger/OpenAPI at `/docs`, static assets under `/public/*`).
- Security: API key guard (`apiKeyPreHandler`) is applied only to `/api/*` routes via `security.plugin.ts`.
- Public routes (e.g., `/health`, `/docs/*`, `/public/*`) are not checked by API key guard.
- Validate required env vars with Zod in `infra/config/index.ts`.
- Export a typed `config` object. Do not read `process.env` outside config.

## Logging
- Use Fastify's built-in Pino logger with structured logging.
- Logger is configured in `server.ts` with pino-pretty for development.
- Attach a request-id to each request automatically via Fastify.
- Do not use `console.log` in production code.

## Error Handling
- Use `AppError(status, message)` for expected errors.
- Fastify error handler maps:
  - `AppError` → `{ error: { code: string?, message: string } }` with `statusCode`
  - Other errors → 500 with generic message (log details)
- Never leak stack traces to clients.

## Validation & OpenAPI
- Define Zod schemas per route for params/query/body/reply.
- Use `fastify-type-provider-zod` to bind schemas to routes for typed handlers.
- Generate OpenAPI via `@fastify/swagger` and serve via `@fastify/swagger-ui`.
- Keep schemas adjacent to controllers or in a `schemas/` sibling directory.

## Database & Migrations
- Initialize `pg` Pool + Drizzle in `infra/db/drizzle.ts`.
- Export `db` and `dbReady` promise (health check on boot).
- Migrations via `drizzle-kit`. SQL lives under `apps/server/src/db/migrations` (or drizzle default). Do not edit generated SQL manually.

## API Conventions
- Base path: `/api` (no versioning for now). If added later: `/api/v1`.
- JSON only. Use consistent response envelopes:
  - Success: `{ data: <payload> }`
  - Error: `{ error: { message, code? } }` (general routes); the chat routes are the
    documented exception — see below.
- Names: plural resources (e.g., `/users/:id`). Custom actions are subresources (e.g., `/messages`).
- **`POST /api/bot/chat` error codes** (ADR-0013 §6, P5, INV-LLM-006): the catch block maps
  a typed `ConversationError` (`domain/conversation/errors.ts`) through `HTTP_STATUS_BY_CODE`
  and replies `{ error: { code } }` — **no `message` field, no exception text, no stack**.

  | HTTP | `code` | Meaning |
  |---|---|---|
  | 503 | `LLM_UNAVAILABLE` | The provider (or the network path to it) failed or timed out; run row `outcome: 'llm_unavailable'` |
  | 409 | `THREAD_BUSY` | The per-user run mutex rejected the request after `LLM_RUN_MUTEX_WAIT_MS`; the graph was never entered, so **no run row is written** (D-D) |
  | 500 | `CORE_ERROR` | Anything else (a bug, an unexpected exception); run row `outcome: 'core_error'` |

  `req.log.error({ err })` still carries the original message for logs — only the response
  body is restricted.

## Testing Strategy
- Unit: domain services with repository stubs.
- Integration: Fastify app via `fastify.inject()` or supertest; seed DB for scenarios.
- E2E (optional): run server against a test DB (`.env`).

## Migration Status ✅ COMPLETED
The Express → Fastify migration has been successfully completed:

✅ **Phase 1**: Fastify server setup with plugins, error handling, CORS, sensible, swagger
✅ **Phase 2**: Zod schemas for all routes with OpenAPI documentation
✅ **Phase 3**: Pino logging integration with Fastify
✅ **Phase 4**: Clean DI pattern with `app.decorate('services', {...})`
✅ **Phase 5**: Plugin architecture with proper encapsulation
✅ **Phase 6**: Security plugin with API key authentication
✅ **Phase 7**: All Express dependencies removed

The application now runs entirely on Fastify with clean architecture, proper layering, and comprehensive test coverage.

## AI Collaboration Guardrails (read carefully)
These rules are for any AI assistant working in this repo:

1) Do not restructure folders or rename modules beyond the Migration Plan.
2) Do not introduce new frameworks or patterns not listed here.
3) Respect layering rules and DI tokens. No manual `new` of services in controllers.
4) Use existing error type `AppError`. Do not create parallel error classes.
5) Use Pino for logging; do not use `console.*` outside tests.
6) Validate all route inputs/outputs with Zod and keep schemas in the app layer.
7) Keep DB logic in repositories; do not call Drizzle directly from controllers or domain services.
8) Update this document if an architectural change is truly required; include rationale and impact.
9) For non-trivial changes, add an ADR entry under `docs/adr/` (see below).
10) Preserve `tsconfig.json` path aliases and update imports accordingly if files move.

## Conversation Context (Session) [FEAT-0009] ✅ IMPLEMENTED (episode memory, refactor P4)
- **Dialogue memory** is the checkpointed LangGraph `messages` channel (PostgresSaver): it survives runs, interleaves as `BaseMessage`s (human / AI with `tool_calls` / tool results) and is the only source of history for every phase (INV-LLM-001/002). One chat across the app — no per-phase history.
- **Episodes end by rule** — inactivity gap (`EPISODE_GAP_HOURS`, default 3), a committed phase transition (`compaction-flag.handler` → `compactReason`), or history-budget overflow — and the synchronous `compact` step in `prepare` summarises the ended episode into one independent structured summary; at most 3 are kept and rendered by the `## Previous episodes` block. Summaries are context, not data: facts (weights, reps) come from tools only (INV-LLM-003).
- **User facts (P6)** — durable facts are written **only at compaction**: the `compact` step upserts summariser v3's `facts` array idempotently on the `(user_id, category, fact_key)` unique index of `user_facts` — a repeat increments `confirmations`, never rewrites `fact`; a failed upsert is logged and never fails the compaction. There is no per-turn fact tool: `remember_fact` (ADR-0013 D-14) was **dropped by owner decision 2026-09-17**. Facts render as the `## User Facts` block at block 2, ahead of `## Previous episodes`, budgeted against `longTerm` (ADR-0013 §3.4); zero facts render nothing. A `physical_constraint` fact with a `muscleGroup` is hard-enforced by `save_workout_plan` and `start_training_session` (`checkFactConflicts`, `domain/user/services/fact-conflicts.ts`): an exercise whose **primary** muscles include it is rejected with a `user_error` quoting the fact and nothing is persisted; secondary involvement and other categories do not bind (AC-1361).
- **Transcript** (`conversation_turns` table) is an append-only projection: the `commit` node writes one row per message (`kind` human/ai/tool_call/tool_result, plus mirrored `summary` rows and `system_note`s), each carrying the run's `run_id`.
- **Clear context**: `POST /api/bot/chat/clear-context` calls `ConversationRunPort.clearContext(userId)` — the adapter deletes the checkpoint thread and appends a `context_cleared` system note; the next message starts fresh.
- **ADR-0005**: original patterns (superseded — no context service, no sliding window; the legacy `IConversationContextService` was deleted in P4).
- No breaking change to API: `POST /api/chat` contract unchanged [AC-0110].
- **Database storage**: `conversation_turns` table with (userId, phase, role, content, runId, kind, payload, createdAt); `user_facts` table — durable user facts with a confirmation counter (P6, migration `0005`); `conversation_summaries` table — structured episode summaries (ADR-0013 §8, written at compaction via `SummaryPort`); `conversation_runs` table — one row per run with model/tokens/latency/outcome (ADR-0013 §8, written by the commit node); `langgraph_checkpoints` table (managed by PostgresSaver).

## LLM Integration
**Implementation**: `src/infra/ai/model.factory.ts`

### OpenAI-Compatible API via LangGraph Tool Calling
- Supports any OpenAI-compatible API provider: OpenAI, OpenRouter, Groq, Together, Azure OpenAI, etc.
- All graph nodes use `ChatOpenAI` directly via shared `getModel()` factory.
- Tool calling (`model.bindTools(tools).invoke()`) is the standard interaction pattern — no JSON mode parsing.

### Environment Configuration
Required environment variables for LLM integration:
```bash
LLM_API_KEY=<your-api-key>           # Required: API key for the provider
LLM_MODEL=<model-name>                # Required: e.g., "google/gemini-2.0-flash-001"
LLM_API_URL=<custom-base-url>         # Optional: custom endpoint (defaults to OpenAI)
LLM_TEMPERATURE=<0-2>                 # Required: temperature for generation
```

### Interaction Pattern (Tool Calling Loop)
Each phase subgraph runs a tool-calling loop:
1. `agentNode`: `model.bindTools(tools).invoke(assembleContext(...))` — `[SystemMessage(systemPrompt), (## User Facts), (## Previous episodes), (domain blocks), ...history, ...current]`, history interleaved from the checkpointed `messages` channel
2. If `AIMessage.tool_calls` present → the tool executor runs them → `ToolMessage` results appended
3. Loop back to `agentNode` with updated messages (tool results visible)
4. If no `tool_calls` → `finalize` returns `{}` — the reply is the last `AIMessage` in state; `commit` reads `pendingTransition` and projects the run

### Tool Calling vs JSON Mode
- **Old approach**: LLM forced to respond in JSON → code parses with Zod → error-prone
- **New approach**: LLM calls typed tools for side effects → responds with natural text → LLM self-corrects on tool errors

### Verified Provider Support
- `google/gemini-2.0-flash-001` via OpenRouter — tool calling with 5+ simultaneous tools verified (2026-02-22)

## ADRs (Architecture Decision Records)
- Create `docs/adr/` and add numbered ADRs for major decisions.
- Example: `docs/adr/0001-fastify-as-web-framework.md` with context, decision, consequences.

### Current ADRs
- **ADR-0001**: AI system integration via LangChain
- **ADR-0002**: Interface organization by functional areas (modular ports)
- **ADR-0003**: Config layer with Zod validation
- **ADR-0004**: User profile and context storage model
- **ADR-0005**: Conversation context with sliding window and phase transitions
- **ADR-0006**: Session plan storage
- **ADR-0007**: LangGraph migration — IN PROGRESS (Steps 0–6 done; see `docs/ADR-0007-IMPLEMENTATION-PLAN.md`)
- **ADR-0008**: Centralized logging with Grafana/Loki
- **ADR-0009**: User long-term memory — passive fact extraction per conversation turn, persistent `user_facts` table, injected into all phase prompts (PROPOSED; its per-turn extraction mechanism is superseded by the 2026-09-17 owner decision — P6 reuses its table shape and categories, extraction happens at compaction)
- **ADR-0010**: Conversation thread summarization (PROPOSED)
- **ADR-0011**: Training tool execution hardening (PROPOSED, partially implemented)
- **ADR-0012**: Exercise catalog vector search
- **ADR-0013**: LLM core target architecture — messages-channel memory, episode compaction, versioned prompts, `Command` from tools, typed error model (PROPOSED — see `docs/LLM_CORE_REFACTOR_PLAN.md`, `docs/PROMPT_EVAL_FRAMEWORK.md`)

## Docs-first Workflow (mandatory)
All changes go through docs before code:

1) Update `docs/API_SPEC.md` (routes, request/response schemas) and, if needed, `ARCHITECTURE.md` or an ADR.
2) Share a short summary in commit message referencing the doc change.
3) Only after docs are merged/approved, implement code to match the spec.
4) If implementation reveals a mismatch, update docs first, then code.

Change control:
- No new routes, models, or modules without a corresponding API_SPEC or ADR update.
- Keep docs minimal but precise (Zod-like schema snippets or OpenAPI examples).

## How to Add a Feature (checklist)
1) Define the route(s) and Zod schemas (request/response).
2) Write a controller using DI-resolved domain services.
3) Implement missing domain logic in `domain/*/services/*`.
4) Add/extend repository methods if needed.
5) Add tests (unit/integration) and update Swagger examples.
6) Ensure logs and errors follow conventions.

## Naming & Style
- Use explicit, descriptive names (no 1–2 letter vars).
- Keep functions small; handle edge cases early; avoid deep nesting.
- Prefer multi-line, readable code over clever one-liners.

## Current Architecture State
- ✅ Fastify is fully implemented with plugin architecture
- ✅ Clean DI pattern using `app.decorate('services', {...})` in composition root
- ✅ All environment configuration centralized in `@config/index`
- ✅ Proper layering with strict import boundaries enforced by ESLint
- ✅ 275 passing tests (unit + integration)
- ✅ OpenAPI documentation generation with Swagger UI
- ✅ Security plugin with API key authentication for `/api/*` routes
- ✅ LangGraph graph fully operational: prepare/route/commit nodes, PhaseSpec factory subgraphs, checkpointer, transition event handlers
- 🔄 LangGraph migration IN PROGRESS: training subgraph, full transition guard conditions pending (Steps 7–9); session_planning implemented (Step 6 ✓)

---
This document defines architectural contract for the backend. Changes to this contract must be explicit, reviewed, and documented via ADR.
