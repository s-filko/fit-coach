# TODOs (Concise)

## Done (Recent Sessions)
- ~~Unified Registration (FEAT-0006/0007)~~ — single LLM call, JSON mode, unified prompt
- ~~Conversation Context (FEAT-0009)~~ — domain ports, Drizzle impl, DI, sliding window, phase transitions
- ~~ChatService~~ — post-registration conversation mode with FitCoach identity
- ~~ProfileParserService, messages.ts, registration.config.ts~~ — deleted (dead code)
- ~~LLM switch~~ — Gemini → GPT-4 Turbo via OpenAI/OpenRouter, JSON mode (`response_format`)
- ~~DB migrations~~ — conversation_turns, user_accounts tables
- ~~All integration tests updated~~ — 158+ passing tests
- ~~Fastify migration~~ — Express fully removed, plugin architecture implemented
- ~~Documentation updates~~ — ARCHITECTURE.md, API_SPEC.md, FEAT-0003, FEAT-0006, DB_SETUP.md updated
- ~~LLM debug endpoints~~ — `/api/debug/llm` for development monitoring
- ~~OpenAI-compatible API abstraction~~ — Support for OpenAI, OpenRouter, Groq, Together, Azure

## Immediate
- ~~Sync test env naming in `docs/DB_SETUP.md` to `.env.test`~~ ✅ Done
- ~~Update feature specs to reflect current architecture~~ ✅ Done (FEAT-0003, FEAT-0006)
- ~~Replace root `README.md` with index linking to canonical docs~~ ✅ Done
- ~~Update FEAT-0007 to align with unified registration approach~~ ✅ Done (marked as Future v2.0)
- ~~Add comments to schema.ts about status models~~ ✅ Done (MVP vs Future)
- Update TESTING.md with examples for conversation context and unified registration

## Registration — Remaining
- Adopt status model `registration|onboarding|planning|active` (planning feature later).
- Fallback response should be in Russian, not English ("Could you please try again?" → Russian).
- Handle edge cases: user sends image/sticker/voice (bot currently ignores non-text).

## Chat Mode — Improvements
- Post-MVP: summarization of older turns via LLM when threshold exceeded [BR-CONV-006].
- Post-MVP: idle threshold policy — reset with recap after long inactivity [BR-CONV-006].

## Tests
- Add integration scenarios S-0025..S-0038, S-0045..S-0048.
- Enforce IDs in test titles (`S-####`, `AC-####`, `BR-*-###`).

## Docs
- ~~FEAT-0006 updated~~ ✅ Complete rewrite with unified JSON mode approach
- ~~FEAT-0003 updated~~ ✅ Added conversation context and phase-based routing
- ~~ARCHITECTURE.md updated~~ ✅ Added LLM Integration, ConversationContext, DI details
- ~~API_SPEC.md updated~~ ✅ Added debug endpoints and registrationComplete field
- ~~DB_SETUP.md updated~~ ✅ Added database schema section with conversation_turns
- ~~docs/README.md index updated~~ ✅ Added new sections and recent updates
- ~~Clean up old FEAT-0006 variant files (3 different files exist)~~ ✅ Done - removed 4 outdated files
- ~~ADR-0004 updated~~ ✅ Documented MVP schema + future evolution plans
- Update FEAT-0007 to align with new registration architecture
- Update TESTING.md with examples for new components

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
