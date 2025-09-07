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
        prompt.ports.ts        # Specialized utility contracts
      services/
        user.service.ts
    ai/
      ports.ts                 # AI domain interfaces
      services/
        ai-context.service.ts
    training/
      ports.ts                 # Training domain interfaces
      services/
        training-context.service.ts

  infra/                        # Integrations + drivers
    db/
      schema.ts                 # Drizzle schema
      drizzle.ts                # Pool + drizzle init + health
      repositories/             # Thin data access
        user.repository.ts
        training-context.repository.ts
    ai/
      llm.service.ts            # LLM/LangChain integration
    di/
      container.ts              # Container + registration
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

## ADRs (Architecture Decision Records)
- Create `docs/adr/` and add numbered ADRs for major decisions.
- Example: `docs/adr/0001-fastify-as-web-framework.md` with context, decision, consequences.

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
- ✅ Comprehensive test coverage with 158 passing tests
- ✅ OpenAPI documentation generation with Swagger UI
- ✅ Security plugin with API key authentication for `/api/*` routes

---
This document defines architectural contract for the backend. Changes to this contract must be explicit, reviewed, and documented via ADR.
