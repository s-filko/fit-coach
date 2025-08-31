# Fit Coach Backend Architecture

This document is the single source of truth for the backend architecture. It exists to keep human and AI collaborators aligned, prevent accidental restructures, and ensure fast feature delivery with minimal friction.

The current code is Express-based. The target runtime is Fastify. Until migration is complete, follow the rules below and the migration plan. Do not introduce new architectural patterns outside of this document.

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
    controllers/                # Route handlers (thin)
    routes/                     # Route registration
    middlewares/                # Error, logging, validation hooks
    server.ts                   # Builds Fastify instance (plugins, hooks, routes)
    bootstrap.ts                # Config + DI init + server start

  domain/                       # Business logic (framework-agnostic)
    user/
      types.ts
      services/
        user.service.ts
    ai/
      types.ts
      services/
        ai-context.service.ts
    training/
      types.ts
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
      tokens.ts                 # DI tokens (string consts)
      container.ts              # Container + registration
    config/
      index.ts                  # Env loading + Zod validation
    logging/
      logger.ts                 # Pino setup

  shared/
    errors.ts                   # AppError and error helpers
    types.ts                    # Shared DTOs/utility types
```

Notes:
- Keep only one shared package. Prefer `packages/shared` if needed. Do not duplicate under `apps/shared`.
- Controllers are transport-specific (Fastify); domain services must not import Fastify/Express.
- Repositories must remain thin (CRUD, simple joins). Business rules live in domain services.

## Layering Rules (non-negotiable)
1) app → domain → infra (domain can depend on infra contracts but not on app).
2) Controllers call domain services via DI; never instantiate services with `new` inside controllers.
3) Repositories are injected into domain services via DI tokens.
4) Never import from `app/` into `domain/` or `infra/`.
5) DTOs for transport live in `app/` (schemas), domain types live in `domain/`, DB models in `infra/db/schema`.

## Dependency Injection
- Use a simple container with string tokens. Example tokens (define in `infra/di/tokens.ts`):
  - `USER_REPO`, `TRAINING_CONTEXT_REPO`, `LLM`, `AI_CONTEXT`, `USER_SERVICE`
- Register singletons in `infra/di/container.ts`.
- Controllers resolve dependencies from the container; do not construct them manually.
- Request-scoped dependencies: avoid unless truly needed; prefer stateless services.

## Configuration
- Load `.env` based on `NODE_ENV` (e.g., `.env`, `.env.test`).
- Validate required env vars with Zod in `infra/config/index.ts`.
- Export a typed `config` object. Do not read `process.env` outside config.

## Logging
- Use Pino (`infra/logging/logger.ts`).
- Attach a request-id to each request.
- Do not use `console.log` in production code. For transitional code, tag with `[MIGRATION]` and remove post-migration.

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
- E2E (optional): run server against a test DB (`.env.test`).

## Migration Plan (Express → Fastify)
Phase 0 (now):
- Freeze structure. Follow this doc. No new DI frameworks.

Phase 1:
- Add Fastify deps and `app/server.ts` + `app/bootstrap.ts`.
- Implement error handler, logging, CORS, sensible, swagger.
- Wire existing `/api/user` and `/api/message` routes via thin controllers.
- Replace manual service instantiation with DI container resolution.

Phase 2:
- Introduce Zod schemas for routes + bind to swagger.
- Move DB services to `infra/db/repositories/*` (rename only; keep logic stable).
- Keep `domain/*/services/*` pure (no DB imports directly).

Phase 3:
- Clean up legacy Express code (`src/index.ts`, old middlewares) once parity is reached.
- Replace ad-hoc logs with Pino.

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

## Transitional Notes (current state)
- Express is currently used (`src/index.ts`, `src/app.ts`).
- Custom DI container exists under `src/services/di/*` and is used by some routes. During migration, keep using DI but resolve from the centralized container. Do not create duplicate services (e.g., avoid parallel `ai-context.service` implementations).
- Env handling exists in `src/db/db.ts`; will be centralized to `infra/config`.

---
This document defines architectural contract for the backend. Changes to this contract must be explicit, reviewed, and documented via ADR.


