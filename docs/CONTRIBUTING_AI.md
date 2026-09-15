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
- YAGNI: build what the current task needs. No abstraction with a single call site, no
  pass-through layer, no boolean flag standing in for two functions — speculative structure
  is removed, not kept "for later".
- DRY: no copy-paste, and no reinvention of what the repo already has. Search for an existing
  helper before adding one.
- **Interface Organization**: ports live in `domain/*/ports/`, are named by contract (not by layer), and are imported only through the directory's `index.ts`. Size is a signal that a file may hold more than one contract and obliges review, not a hard limit. See `ARCHITECTURE.md` § Interface Organization Principles — the single source of this rule.

## Docs‑First Workflow (Checklist)
1) Update `docs/API_SPEC.md` (routes, Zod‑like schemas, responses, security). If architecture changes, add/edit ADR under `docs/adr/*` and/or `ARCHITECTURE.md`.
2) Implement:
   - Zod schemas in app layer
   - Thin controller calling domain service via DI
   - Domain logic in `domain/*/services/*` (pure, framework‑agnostic)
   - Repository methods in `infra/db/repositories/*` (thin CRUD)
3) Tests (follow `apps/server/TESTING.md`): unit for domain logic, integration for routes/repositories.
4) Logging and unified error handling respected; Swagger updated by schemas.

## Execution Methodology (Superpowers)

Read `docs/STATE.md` first in any working session — it is the orientation point
(in progress / next / scope). Multi-step work follows the Superpowers skills: `brainstorming` → `writing-plans` →
`executing-plans` with `test-driven-development` → `verification-before-completion` →
code review. The division of roles and conflict rules are defined in
`docs/SUPERPOWERS_INTEGRATION.md` — short version:

- Process artifacts (design docs, implementation plans) live in `docs/superpowers/`;
  durable specs stay in `docs/` per this guide and always win on content.
- Every implementation-plan task cites the AC-#### (or refactor-phase criterion) it
  implements and its verification command.
- If a durable spec turns out to be wrong during execution, escalate to the owner —
  never edit it silently.
- Plan status, task lifecycle and delivery rules: `SUPERPOWERS_INTEGRATION.md` § Task
  lifecycle; run `node scripts/state.mjs --check` before finishing. Ideas/findings
  outside current scope go through the `backlog` skill (classify first, write after).
- The disabled project-scope `superpowers@claude-plugins-official` copy must remain
  disabled; the active version is user-scope from `superpowers-marketplace`.

## Documentation System (Rules)
- English only. One concept = one term (no synonyms).
- Docs‑first is mandatory. Every PR includes updated docs.
- Feature change = add/update Feature Spec under `docs/features/`.
- Business rule change = update Domain Spec under `docs/domain/`.
- API change = update `docs/API_SPEC.md` and keep Fastify schemas in sync.
- Architecture change = add ADR under `docs/adr/`.
- All rules, invariants, scenarios, and acceptance criteria must have unique IDs.
- No duplication — reference by ID.

### ID Conventions
- Invariants: `INV-<DOMAIN>-###`
- Business Rules: `BR-<DOMAIN>-###`
- Scenarios: `S-####`
- Acceptance Criteria: `AC-####`
- IDs must appear in docs, code comments (JSDoc near ports/services), and tests.

### Spec Locations
- Domain Specs: `docs/domain/<domain>.spec.md` (≤ 50 lines; must match `apps/server/src/domain/*/ports/*.ts`).
- Feature Specs: `docs/features/FEAT-####-*.md` (User Story, Scenarios, Acceptance Criteria, API Mapping, Domain Rules Reference).
- API Spec: `docs/API_SPEC.md` (each endpoint: path, method, request/response schema; include `x-feature: FEAT-####`).
- ADRs: `docs/adr/000X-*.md` (fundamental/breaking changes only).

### AI Reading Order
1) Feature Spec
2) Domain Spec
3) API_SPEC.md
4) ARCHITECTURE.md
5) ADRs

## PR Checklist (Docs)
- Feature PR includes a Feature Spec with IDs (S/AC) and BR references.
- Domain rule change updates Domain Spec (INV/BR/Ports) and references IDs in code/tests.
- API change updates API_SPEC with `x-feature` and keeps route schemas in sync.
- Architecture change adds an ADR.
- No duplication; IDs are unique and referenced consistently.

## Playbooks

### Add API Endpoint
1) Spec:
   - Edit `docs/API_SPEC.md:1` with request/response schemas and security (X‑Api‑Key where required).
   - Add `x-feature: FEAT-####` and create/update matching Feature Spec under `docs/features/`.
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
   - Update the relevant Feature Spec scenarios/AC and link BR IDs.
2) Data layer:
   - Update `apps/server/src/infra/db/schema.ts:1` and generate Drizzle migrations (see project scripts).
   - Update user repository `apps/server/src/infra/db/repositories/user.repository.ts:1`.
   - Update repository interface in `apps/server/src/domain/user/ports/repository.ports.ts` if needed.
3) Domain & App:
   - Update types and service logic: `apps/server/src/domain/user/services/user.service.ts:1`.
   - Update service interfaces in `apps/server/src/domain/user/ports/service.ports.ts` if needed.
   - Update profile-field validation: `apps/server/src/domain/user/services/registration.validation.ts:1`.
   - Adjust Zod schemas in routes that expose these fields.
4) Tests:
   - Unit tests for parsing/validation and domain logic.
   - Integration tests to verify persistence and API responses.

### Adjust Registration Flow / Prompts
1) Spec the interaction in `docs/API_SPEC.md:1` (if API changes), or ADR for behavioral changes.
   - Update Feature Spec (scenarios and AC) with BR references.
2) Update registration prompt wording and flow (graph-driven since the prompt-service removal):
   - `apps/server/src/infra/ai/graph/nodes/registration.node.ts:1` (system prompt)
   - `apps/server/src/infra/ai/graph/tools/registration.tools.ts:1` (save_profile_fields / complete_registration tools)
3) Update profile-field validation:
   - `apps/server/src/domain/user/services/registration.validation.ts:1`
4) Keep error format and logging consistent; add/adjust tests accordingly.

### Integrate Conversation Context into a Flow
1) Spec:
   - Verify FEAT-0009 scenarios and domain rules in `docs/features/FEAT-0009-conversation-context.md` and `docs/domain/conversation.spec.md`.
   - Reference BR-CONV-001..BR-CONV-007 in code and tests.
2) Domain:
   - Import `IConversationContextService` and `CONVERSATION_CONTEXT_SERVICE_TOKEN` from `domain/conversation/ports/`.
   - Use `ChatMsg` type (shared with AI domain) for message arrays.
3) Orchestration (route or orchestrator service):
   - Determine phase from user state (e.g. profileStatus -> 'registration' or 'chat').
   - Load: `ctx = await conversationContextService.getContext(userId, phase)` [BR-CONV-001].
   - Build: `history = conversationContextService.getMessagesForPrompt(ctx, {maxTurns: 20})` [BR-CONV-003].
   - Call LLM: `llmGateway.chat([...history, {role:'user', content: message}], {runId})`.
   - Persist: `await conversationContextService.appendTurn(userId, phase, message, response)` [BR-CONV-002].
   - On phase change: `await conversationContextService.startNewPhase(userId, oldPhase, newPhase, systemNote)` [BR-CONV-005].
4) Tests:
   - Unit: mock IConversationContextService; verify orchestrator calls getContext, getMessagesForPrompt, appendTurn in order.
   - Integration: verify sliding window truncation [S-0059], phase reset [S-0060], full flow [S-0063].
5) DI: resolve via `CONVERSATION_CONTEXT_SERVICE_TOKEN`; register in `main/bootstrap.ts`.

## Templates
- Domain Spec: `docs/templates/domain.spec.template.md`
- Feature Spec: `docs/templates/feature.spec.template.md`
- ADR: `docs/templates/adr.template.md`

## DI & Ports Quick Reference
- Container (singleton): `apps/server/src/infra/di/container.ts:1`
- DI registration (composition root): `apps/server/src/main/bootstrap.ts:1`
- How to resolve in routes:
  ```ts
  const c = Container.getInstance();
  const service = c.get<UserService>(USER_SERVICE_TOKEN);
  ```

### Tokens and Ports (examples)
- AI:
  - LLM gateway token and port: `apps/server/src/domain/ai/ports/llm.gateway.ports.ts`
- User domain tokens: `apps/server/src/domain/user/ports/` (modular structure)
  - Repository ports: `apps/server/src/domain/user/ports/repository.ports.ts`
  - Service ports: `apps/server/src/domain/user/ports/service.ports.ts`
  - Convenience imports: `apps/server/src/domain/user/ports/index.ts`
- Conversation context:
  - Token and port: `apps/server/src/domain/conversation/ports/conversation-context.ports.ts`
  - `CONVERSATION_CONTEXT_SERVICE_TOKEN` -> `IConversationContextService`

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
