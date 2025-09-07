# TODOs (Docs-First / Testing / CI)

## Immediate
- Docs: Sync test env naming in `docs/DB_SETUP.md:1` to `.env.test` (and optionally `.env.test.integration`, `.env.test.e2e`) to match `apps/server/drizzle.config.ts:1` and `apps/server/src/app/test/setup.ts:1`.
- Root README: Replace outdated root `README.md:1` with a short index that links to authoritative docs (`docs/README.md:1`, `docs/ARCHITECTURE.md:1`, `docs/API_SPEC.md:1`, `docs/CONTRIBUTING_AI.md:1`).

## Testing Discipline
- IDs in tests: Update `apps/server/TESTING.md:1` to mandate referencing doc IDs in test names (`S-####`, `AC-####`, `BR-<DOMAIN>-###`). Add examples for `describe/it`.
- Migration note: Gradually update existing tests to include IDs in `describe/it` names (starting with integration suites under `apps/server/tests/integration/**`).

## CI / Automation
- Add check: Each endpoint in `docs/API_SPEC.md:1` must include `x-feature: FEAT-####`.
- Add check: Each `FEAT-####` referenced in `docs/API_SPEC.md:1` appears in at least one test (filename or test title).
- Add check: Warn when test titles lack any of `S-`, `AC-`, or `BR-` IDs (soft rule initially).

## Quality Guards
- Add an integration test to snapshot generated OpenAPI JSON (large structure) to detect API drift (allowed per `apps/server/TESTING.md:1`).

Notes
- Keep changes minimal and aligned with `docs/ARCHITECTURE.md:1` and `apps/server/jest.config.cjs:1`.
