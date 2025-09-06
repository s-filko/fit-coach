# AI Contribution Guide

This guide defines how AI assistants contribute to this repo. It complements and defers to:
- ARCHITECTURE (single architectural source of truth): `ARCHITECTURE.md:1`
- API contracts (schemas, security, responses): `docs/API_SPEC.md:1`
- Test rules and structure: `apps/server/TESTING.md:1`

If any instruction here conflicts with the above docs, update this file to match them.

## Principles & Boundaries
- Keep layering strict: app → domain → infra. No domain → infra imports.
- Use DI tokens and ports; do not `new` services in controllers.
- Validate all routes with Zod (request and response) and expose via Swagger.
- Use Pino logging; no `console.*` in production code.
- Errors: unified envelope `{ error: { message, code? } }`. No stack traces to clients.
- DB access only via repositories in infra; domain and app never import Drizzle directly.
- Docs‑first: update `docs/API_SPEC.md` and, if needed, `ARCHITECTURE.md`/ADR before writing code.
- Do not restructure folders beyond the migration plan in `ARCHITECTURE.md`.
- **Interface Organization**: Organize interfaces by functional areas in `domain/*/ports/` with modular files (repository.ports.ts, service.ports.ts, etc.). Keep files under 50 lines.

## Docs‑First Workflow (Checklist)
1) Update `docs/API_SPEC.md` (routes, Zod‑like schemas, responses, security). If architecture changes, add/edit ADR under `docs/adr/*` and/or `ARCHITECTURE.md`.
2) Implement:
   - Zod schemas in app layer
   - Thin controller calling domain service via DI
   - Domain logic in `domain/*/services/*` (pure, framework‑agnostic)
   - Repository methods in `infra/db/repositories/*` (thin CRUD)
3) Tests (follow `apps/server/TESTING.md`): unit for domain logic, integration for routes/repositories.
4) Logging and unified error handling respected; Swagger updated by schemas.

## Playbooks

### Add API Endpoint
1) Spec:
   - Edit `docs/API_SPEC.md:1` with request/response schemas and security (X‑Api‑Key where required).
2) App layer:
   - Create/update route under `apps/server/src/app/routes/*.ts` with Zod body/params/query/reply schemas.
   - Register within `apps/server/src/app/server.ts:1` (via route register function).
3) Domain/Infra:
   - If new logic: add/extend service in `apps/server/src/domain/**/services/*`.
   - Add/extend repository in `apps/server/src/infra/db/repositories/*` (no business rules).
4) Tests:
   - Integration test in `apps/server/tests/integration/api/*.integration.test.ts` using `buildServer()` + `inject`.
   - Avoid duplicating API‑key middleware tests in every route; keep them centralized under middleware tests.

### Extend User Profile / Registration
1) Spec & ADR:
   - Update `docs/API_SPEC.md:1` (new/changed fields) and add ADR if this is a significant model change.
2) Data layer:
   - Update `apps/server/src/infra/db/schema.ts:1` and generate Drizzle migrations (see project scripts).
   - Update user repository `apps/server/src/infra/db/repositories/user.repository.ts:1`.
   - Update repository interface in `apps/server/src/domain/user/ports/repository.ports.ts` if needed.
3) Domain & App:
   - Update types and service logic: `apps/server/src/domain/user/services/user.service.ts:1`.
   - Update service interfaces in `apps/server/src/domain/user/ports/service.ports.ts` if needed.
   - Update registration/profile parsing logic: `apps/server/src/domain/user/services/registration.service.ts:1`, `apps/server/src/domain/user/services/profile-parser.service.ts:1`.
   - Adjust Zod schemas in routes that expose these fields.
4) Tests:
   - Unit tests for parsing/validation and domain logic.
   - Integration tests to verify persistence and API responses.

### Adjust Registration Flow / Prompts
1) Spec the interaction in `docs/API_SPEC.md:1` (if API changes), or ADR for behavioral changes.
2) Update prompt building and messages:
   - `apps/server/src/domain/user/services/prompt.service.ts:1`
   - `apps/server/src/domain/user/services/messages.ts:1`
   - Update prompt interface in `apps/server/src/domain/user/ports/prompt.ports.ts` if needed.
3) Update profile parser and registration orchestrator:
   - `apps/server/src/domain/user/services/profile-parser.service.ts:1`
   - `apps/server/src/domain/user/services/registration.service.ts:1`
   - Update service interfaces in `apps/server/src/domain/user/ports/service.ports.ts` if needed.
4) Keep error format and logging consistent; add/adjust tests accordingly.

## DI & Ports Quick Reference
- Container (singleton): `apps/server/src/infra/di/container.ts:1`
- DI registration (composition root): `apps/server/src/app/bootstrap.ts:1`
- How to resolve in routes:
  ```ts
  const c = Container.getInstance();
  const service = c.get<UserService>(USER_SERVICE_TOKEN);
  ```

### Tokens and Ports (examples)
- AI:
  - LLM service token and port: `apps/server/src/domain/ai/ports.ts:1`
- User domain tokens: `apps/server/src/domain/user/ports/` (modular structure)
  - Repository ports: `apps/server/src/domain/user/ports/repository.ports.ts`
  - Service ports: `apps/server/src/domain/user/ports/service.ports.ts`
  - Prompt ports: `apps/server/src/domain/user/ports/prompt.ports.ts`
  - Convenience imports: `apps/server/src/domain/user/ports/index.ts`

When adding new ports, define `unique symbol` tokens and interfaces under `domain/*/ports/` with modular organization. Implement in `infra/*` and register in `bootstrap.ts` via `register`/`registerFactory`.

#### Interface Organization Rules
- **Repository interfaces**: Data access contracts in `repository.ports.ts`
- **Service interfaces**: Business logic contracts in `service.ports.ts`
- **Specialized interfaces**: Domain-specific utilities in separate files
- **File size**: Keep under 50 lines for readability
- **Import strategy**: Use `index.ts` for convenience or import directly from specific files

## API Quality Rules
- Zod for request and response. Attach schemas to routes using `fastify-type-provider-zod`.
- Security: enforce `X-Api-Key` on protected routes as per `docs/API_SPEC.md:1`.
- Errors: `{ error: { message, code? } }` only. Use `apps/server/src/app/middlewares/error.ts:1`.
- Logging: Pino via `buildServer()`; attach request‑id if added later.
- No direct Drizzle in controllers or domain services.

## Testing (must)
- Follow `apps/server/TESTING.md:1` strictly.
- Unit tests: `src/**/__tests__/*.unit.test.ts` (pure logic, mock deps).
- Integration tests: `apps/server/tests/integration/**/*.integration.test.ts` (Fastify routes, repos, real DB if applicable).
- No duplicate middleware tests across endpoints; keep them in middleware suites.

## Migration Status & Docs Sync
- Runtime: Fastify (Express references are legacy). Source of truth: `ARCHITECTURE.md:1`.
- If you encounter conflicting docs (e.g., outdated README), follow `ARCHITECTURE.md` and open a docs sync patch.

## PR & Commit Discipline
- Commit message references the doc change: `docs(API|ARCH|ADR): ...` then `feat|fix|refactor(server): ...`.
- No new routes/models without an accompanying `docs/API_SPEC.md` and, if needed, ADR.

## Do Not
- Introduce frameworks or patterns not listed in `ARCHITECTURE.md`.
- Bypass DI or import infra from domain.
- Change error/response formats ad hoc.
- Modify folder structure outside the migration plan.

---
This guide is optimized for AI contributors to deliver consistent, reversible changes with minimal architectural drift. If a change requires deviating from these rules, write an ADR first.

