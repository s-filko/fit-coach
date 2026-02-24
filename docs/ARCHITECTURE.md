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
      chat.routes.ts            # ~20-line thin proxy to ConversationGraph
    plugins/                    # Fastify plugins (routes, security, docs)
    middlewares/                # Error, logging, validation hooks
    server.ts                   # Builds Fastify instance (plugins, hooks, routes)
    types/                      # Fastify type declarations

  domain/                       # Business logic (framework-agnostic)
    user/
      ports/                    # Modular interface organization
        index.ts               # Re-exports for convenience
        repository.ports.ts    # Data access contracts
        service.ports.ts       # Business logic contracts
        prompt.ports.ts        # Specialized utility contracts (TODO: remove after Step 9)
      services/
        user.service.ts        # User CRUD operations
        prompt.service.ts      # Dynamic system prompt generation (TODO: remove after Step 9)
      validation/
        registration.validation.ts # Zod validators for registration fields (reused in tools)
    ai/
      ports.ts                 # ILLMService interface (TODO: remove after Step 9)
    conversation/
      graph/
        conversation.state.ts  # LangGraph ConversationState (Annotation.Root)
      ports/
        conversation-context.ports.ts  # IConversationContextService (2-method: appendTurn + getMessagesForPrompt)
        index.ts               # Re-exports
    training/
      ports/                   # Training domain interfaces

  infra/                        # Integrations + drivers
    db/
      schema.ts                 # Drizzle schema (users, user_accounts, conversation_turns, etc.)
      drizzle.ts                # Pool + drizzle init + health
      repositories/             # Thin data access
        user.repository.ts
        exercise.repository.ts  # Includes findAllWithMuscles()
        workout-plan.repository.ts
    ai/
      model.factory.ts          # Shared ChatOpenAI factory (getModel())
      graph/
        conversation.graph.ts   # Main StateGraph: router→phase→persist→guard→cleanup
        nodes/
          router.node.ts        # Phase determination, session timeout, user loading
          persist.node.ts       # appendTurn to conversation_turns
          chat.node.ts          # buildChatSystemPrompt()
          registration.node.ts  # buildRegistrationSystemPrompt()
          plan-creation.node.ts # buildPlanCreationSystemPrompt() with muscle groups
        subgraphs/
          chat.subgraph.ts         # agent + ToolNode + extractNode
          registration.subgraph.ts # agent + ToolNode + extractNode
          plan-creation.subgraph.ts# agent + ToolNode + extractNode
        tools/
          chat.tools.ts            # update_profile, request_transition
          registration.tools.ts    # save_profile_fields, complete_registration
          plan-creation.tools.ts   # save_workout_plan, request_transition
    conversation/
      drizzle-conversation-context.service.ts   # IConversationContextService impl (2-method, DB-backed)
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
- **Separation by Functional Areas**: Organize interfaces by responsibility, not by type
- **Modular Structure**: Use `domain/*/ports/` directory with specialized files:
  - `repository.ports.ts` - Data access contracts
  - `service.ports.ts` - Business logic contracts  
  - `prompt.ports.ts` - Specialized utility contracts
  - `index.ts` - Re-exports for convenience
- **File Size Limits**: Keep interface files under 50 lines for readability
- **Single Responsibility**: Each file handles one functional area
- **Backward Compatibility**: Main `ports.ts` re-exports from modular structure

### Enforced by ESLint (import boundaries)
- Domain (`src/domain/**`): cannot import `@app/*`, `**/app/**`, `@infra/*`, `**/infra/**`.
- App (`src/app/**`): cannot import infra implementations: `@infra/db/**`, `@infra/ai/**` (DI container access allowed).
- Infra (`src/infra/**`): cannot import `@app/*`, `**/app/**`.
- See `apps/server/eslint.config.js:1` for rules. Violations fail lint.

## Dependency Injection
- DI tokens and port interfaces live in `domain/*/ports/` with modular organization (or a neutral `shared/core` if порт общий по доменам).
- **DI tokens are declared as `unique symbol` next to their corresponding port interfaces** in the same file (e.g., `USER_SERVICE_TOKEN` alongside `IUserService`).
- Port implementations are located in `infra/*` and registered in the composition root.
- App / controllers and routes depend only on ports and tokens, NOT on implementations.
- Request‑scoped dependencies are used only when transactions are needed; singletons by default.
- **Composition Root = `src/main/**`**: dependency assembly (implementation registration, container, config, and server startup) is performed in `src/main/**`. App layer does not import or resolve implementations from the container.
- **Import Strategy**: for domain contracts, use `domain/*/ports/index.ts` or specific port files.

### DI Container Implementation
- Container (`src/infra/di/container.ts`) supports both direct instance registration and factory-based lazy initialization.
- **Factory pattern**: `container.registerFactory(token, (container) => new Service(...))` allows lazy instantiation and access to other dependencies via the container parameter.
- **Lazy initialization**: Services registered with factories are instantiated only on first `container.get(token)` call, preventing circular dependencies and improving startup time.
- **Service registration order** (`src/main/register-infra-services.ts`):
  1. ConversationContextService (Drizzle-backed, 2-method interface)
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
  - Error: `{ error: { message, code? } }`
- Names: plural resources (e.g., `/users/:id`). Custom actions are subresources (e.g., `/messages`).

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

## Conversation Context (Session) [FEAT-0009] ✅ IMPLEMENTED (simplified)
- **Conversation history** (`conversation_turns` table) stores dialogue turns per (userId, phase) for prompt building and analytics.
- **Phase/session state** is managed by **LangGraph PostgresSaver checkpointer** — not by `IConversationContextService`. No `[PHASE_ENDED]` markers, no `startNewPhase()`.
- Domain port: `IConversationContextService` (2 methods only):
  - `appendTurn(userId, phase, userMessage, assistantResponse): Promise<void>`
  - `getMessagesForPrompt(userId, phase, options?): Promise<ChatMsg[]>`
- Each phase subgraph calls `getMessagesForPrompt()` to load history before building the LLM prompt. `persist.node.ts` calls `appendTurn()` after each response.
- **Sliding window** (default 20 turns) via `LIMIT` in SQL query [BR-CONV-003].
- Module layout: `domain/conversation/ports/conversation-context.ports.ts`; `infra/conversation/drizzle-conversation-context.service.ts`.
- **ADR-0005**: original patterns (partially superseded by checkpointer for state management).
- No breaking change to API: `POST /api/chat` contract unchanged [AC-0110].
- **Database storage**: `conversation_turns` table with (userId, phase, role, content, createdAt); `langgraph_checkpoints` table (managed by PostgresSaver).

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
1. `agentNode`: `model.bindTools(tools).invoke([systemMsg, history..., humanMsg, ...stateMessages])`
2. If `AIMessage.tool_calls` present → `ToolNode` executes tools → `ToolMessage` results appended
3. Loop back to `agentNode` with updated messages (tool results visible)
4. If no `tool_calls` → `extractNode` extracts `responseMessage`, reads `pendingTransition`

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
- **ADR-0007**: LangGraph migration — IN PROGRESS (Steps 0–5 done; see `docs/ADR-0007-IMPLEMENTATION-PLAN.md`)
- **ADR-0008**: Centralized logging with Grafana/Loki

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
- ✅ LangGraph graph fully operational: router + persist nodes, checkpointer, chat/registration/plan_creation subgraphs
- 🔄 LangGraph migration IN PROGRESS: session_planning, training, transition guards pending (Steps 6–9)

---
This document defines architectural contract for the backend. Changes to this contract must be explicit, reviewed, and documented via ADR.
