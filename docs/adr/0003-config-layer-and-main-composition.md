# ADR 0003: Introduce Config Layer and Move Composition Root to `src/main/**`

## Status
Accepted – Implemented

## Context
Previously, configuration lived in `infra/config`, and bootstrap ran under `app`, with some DI registration triggering DB schema checks implicitly. This blurred architectural boundaries and complicated tests (unit runs touching DB).

## Decision
1) Create a dedicated Config layer at `apps/server/src/config/**` with alias `@config/*`.
   - `loadConfig()` validates environment via Zod and returns typed `Env`.
   - One‑way dependency: app/domain/infra → config; config imports nothing.

2) Move composition root to `apps/server/src/main/**`.
   - `bootstrap.ts`: creates DI container, registers infra implementations, builds server, starts listening.
   - `register-infra-services.ts(container, opts?)`: side‑effects disabled by default; `opts.ensureDb` governs DB schema ensure for integration setups.

3) App boundaries remain strict.
   - App imports only ports/interfaces and config; no infra or DI implementation imports.
   - Security and docs handled via dedicated Fastify plugins.

## Consequences
- Clearer separation of concerns; app is transport only, main composes, infra implements.
- Unit tests no longer require DB; integration tests opt‑in with `RUN_DB_TESTS=1`.
- Jest updated with `@config/*` and `@main/*` aliases.
- API key guard applies only to `/api/*` (via `security.plugin.ts`), keeping docs/static public.

## Migration Notes
- Replace `@infra/config` imports with `@config/index`.
- Use `registerInfraServices(container, { ensureDb: true })` only in integration environments or test setup.
- Bootstrap moved: `src/app/bootstrap.ts` → `src/main/bootstrap.ts`; index imports `@main/bootstrap`.

## Links
- ARCHITECTURE.md – Configuration, Composition Root, HTTP Plugins & Security
- TESTING.md – Unit vs Integration setup, `RUN_DB_TESTS` flag, Jest aliases

