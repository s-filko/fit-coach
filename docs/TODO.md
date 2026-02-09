# TODOs (Concise)

## Immediate
- Sync test env naming in `docs/DB_SETUP.md` to `.env.test` (match server configs).
- Replace root `README.md` with an index linking to canonical docs.

## Registration (FEAT-0006/0007) — MVP Extension
- Adopt status model `registration|onboarding|planning|active` (planning feature to be delivered later) (code, tests, DB default).
- Rename to `sex` and `goal` across domain + DB (update data).
- Derived confirmation: summary → explicit confirm → `onboarding`; after onboarding or skip → `planning` (plan feature drives transition to `active`).
- Language flows per BR-USER-006/BR-UX-001.
- Parser: registration extraction + normalization; single clarification on ambiguity.
- Adopt ADR-0004 storage extension (user_profile 1:1, user_context 1:1 jsonb; later: user_metrics 1:N, embeddings optional).

## Tests
- Add integration scenarios S-0025..S-0038, S-0045..S-0048.
- Enforce IDs in test titles (`S-####`, `AC-####`, `BR-*-###`).
- Assert `/api/chat` response shape `{ data: { content, timestamp } }`.

## Docs
- Replace `/api/message` → `/api/chat` everywhere (incl. root README examples).
- FEAT-0006 flow is canonical; cross-link from FEAT-0006 improvements and FEAT-0007.
- Add ADR-0004 reference in related specs (FEAT-0006/0007, domain user.spec).

## CI / Automation
- Lint: every endpoint in `docs/API_SPEC.md` has `x-feature`.
- Lint: every `FEAT-####` appears in at least one test.
- Warn when test titles lack IDs.

## Quality
- Add integration test to snapshot OpenAPI JSON (detect API drift).

## Planning (FEAT-0008 — post-onboarding)
- Implement workout plan lifecycle via `approvedAt`/`archivedAt` per `docs/features/FEAT-0008-training-plan-generation.md`.
- Persist WorkoutPlanCycle hierarchy (macro|meso|micro) with state tracking (upcoming/active/completed/skipped) and planned/actual timestamps.
- Link workout sessions/logs to planId; exercise history must remain tied to archived plans.
- Ensure activation (`active`) happens only after plan approval; replan archives the previous plan and creates a new plan with `approvedAt=null` (profileStatus='planning').
