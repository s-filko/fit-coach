# Voice Transcription — Telegram Voice Messages Answered as Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first, then the code.

- Status: in progress
- Branch: plan/voice-transcription

**Goal:** a Telegram voice message is transcribed by a speech-to-text call and handled exactly
like the same text typed by the user. The bot's reply starts with the recognised text as a quote,
followed by the coach's answer. Owner 2026-09-27: "когда я отправляю голосовые сообщения в
Telegram, чтобы они были распознаны сервисом Speech to Text, и в ответе текст, который распознан
был первая цитата а затем ответ тренера". Today the bot silently drops any message without
`msg.text` (`apps/bot/handlers.ts` — `if (!userText) return;`).

## Verified facts (2026-09-27, live probes)

- `AISTUDIO_API_KEY` (local `apps/server/.env`, not referenced by any code) authorises Google AI
  Studio `generateContent`. `gemini-3.8-flash` transcribes a Russian OGG/Opus clip (the Telegram
  voice format, 48 kHz mono) verbatim, numbers as digits: 1.8–2.1 s with
  `thinkingConfig: {thinkingLevel: "low"}`, 2.75 s without; ~121 audio tokens for 6 s of speech.
- Request that works: `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`,
  header `x-goog-api-key`, body `{contents:[{parts:[{text:<instruction>},{inline_data:{mime_type:"audio/ogg",data:<base64>}}]}],
  generationConfig:{temperature:0, thinkingConfig:{thinkingLevel:"low"}}}`. Response text is
  `candidates[0].content.parts[].text` (parts may carry `thoughtSignature`; skip parts with `thought: true`).
- `thinkingLevel: "minimal"` → 400 on this model; `thinkingBudget: 0` → 404 with an empty body. Neither may be sent.
- Google Cloud Speech-to-Text rejects API keys (401) — not an option without a service account.
  The Z.AI subscription token was not usable for GLM-ASR in this session. Out of scope.
- Fastify's default `bodyLimit` is 1 MiB; a 5-minute voice at ~32 kbit/s is ~1.2 MB raw, ~1.6 MB base64.

## Decisions (D)

- **D1 — STT lives in the server, behind a port.** New domain port `SpeechTranscriberPort`
  (`transcribe({audioBase64, mimeType}) → Promise<{text: string}>`) with a DI token; infra adapter
  `infra/ai/gemini-transcriber.ts` calling the REST API with `fetch` (no new dependency; `fetch`
  injectable for tests). The bot never holds a provider key. Swapping to another STT provider later
  is a new adapter, nothing else.
- **D2 — config, optional.** `STT_API_KEY` (optional secret — unset = voice disabled, the server
  still boots, so the deploy never breaks on a missing key), `STT_MODEL` (default `gemini-3.8-flash`),
  `STT_API_URL` (default `https://generativelanguage.googleapis.com/v1beta`), `STT_TIMEOUT_MS`
  (default 60000, covers the body read — Task 3 R3), `STT_MAX_OUTPUT_TOKENS` (default 4096 — R2). Tunables-not-secrets exception, same class as `EPISODE_*`. `.env.example` documents them.
- **D3 — route.** `POST /api/bot/voice/transcribe`, `X-Api-Key` auth like every `/api/bot` route,
  body `{userId, audioBase64, mimeType}`, route-level `bodyLimit` 15 MiB.
  `200 {data:{text}}`; `422 {error:{code:'NO_SPEECH'}}` when the model answers the `<NO_SPEECH>` sentinel or an empty text (R1);
  `503 {error:{code:'STT_UNAVAILABLE'}}` when STT is disabled, the provider errors or times out.
  The body never carries the provider's message (INV-LLM-006 style); logs do.
- **D4 — instruction.** One constant: transcribe verbatim in the original language, output only
  the transcript, write numbers as digits, and exactly `<NO_SPEECH>` when nothing is clearly spoken (exact
  text in Task 3 R1). `temperature: 0`, `thinkingLevel: "low"`, `maxOutputTokens` from `STT_MAX_OUTPUT_TOKENS`.
- **D5 — the transcript is the user's message.** The bot sends the transcript to the existing
  `/api/bot/chat` unchanged — the conversation, audit trail (`llm_calls`, transcript) and prompts do
  not change. The STT call itself is logged (userId, model, latency, audio/output tokens, text length),
  not written to `llm_calls` (run-scoped table; a pre-run call has no run).
- **D6 — bot flow for `msg.voice`.** Inside the same `chatQueue` + `withTypingIndicator`:
  duration < 1 s → the `NO_SPEECH` notice (accidental tap, Task 3 R6); duration > 300 s → localized
  "too long" text; neither is downloaded; else download via
  `bot.getFileStream(file_id)` (or `getFileLink` + axios) → base64 → transcribe → on success
  `/api/bot/chat` with the transcript → reply. Voice only: `audio`, `video_note`, documents are out of scope.
- **D7 — reply format.** One message: `<blockquote>🎤 {escapeHtml(transcript)}</blockquote>\n\n{coachReply}`
  through the existing `sendHtml`. Transcript > 500 chars → `<blockquote expandable>`; the displayed
  quote is cut at 3500 raw chars with `…`, then escaped (Task 3 R5), (the coach always gets the full text). If the composed message
  exceeds Telegram's 4096 chars, the quote goes as its own message first, then the reply.
  Empty coach reply → only the quote is sent (the user still sees what was heard).
- **D8 — failure texts (en/ru, profile language like `errorTextFor`).** `NO_SPEECH`: couldn't make out
  the voice message, try again or type it; `STT_UNAVAILABLE`: voice recognition is unavailable right
  now, please type; too long: voice messages up to 5 minutes. Chat errors after a successful
  transcription keep today's `errorTextFor` path, preceded by the quote so the user sees what was heard.
- **D9 — executor:** GLM worker, tasks in one terminal (server, bot, review fixes).
- **D10 — STT outside `LlmGateway` (review B1, owner-delegated 2026-09-27: "будь строгим… доведи до рабочего").**
  Amend ADR-0013 §7 with a narrow carve-out rather than route audio through `getModel(profile)`: the factory is
  bound to one OpenAI-compatible route (Z.AI on dev, no audio), profiles cannot change provider, and
  OpenAI-compatible `input_audio` accepts only wav/mp3. Recorded as the ADR-0013 §7 amendment of 2026-09-27;
  domain spec `docs/domain/speech.spec.md`, feature spec FEAT-0011 (AC-1415..1421, S-0117..0122).

## Acceptance criteria

| AC | Criterion | Verification |
|---|---|---|
| AC-VT-1 | Gemini adapter builds the probed request (URL, header, body incl. `thinkingLevel:"low"`, no `thinkingBudget`), joins non-thought text parts, trims; non-2xx / timeout / malformed body → typed error | server unit tests with a fake `fetch` |
| AC-VT-2 | Config: all `STT_*` optional with the D2 defaults; unset key → transcriber reports disabled, server boots | config unit test |
| AC-VT-3 | Route: 200/422/503 per D3, body limit 15 MiB, auth as other bot routes, no provider message in the body | route test (`app.inject`) with a stub port |
| AC-VT-4 | Bot: voice → transcribe → chat with the transcript; reply is quote + coach reply per D7 (escaping, expandable, split > 4096, empty reply) | bot unit tests with mocked `api` and `bot` |
| AC-VT-5 | Bot: too long / NO_SPEECH / STT_UNAVAILABLE / chat error paths send the D8 texts in the profile language; chat is not called on STT failure | bot unit tests |
| AC-VT-6 | Real call: the local server transcribes `probe.ogg` (Russian, 6 s) through the route with the real key | orchestrator, local, one call |
| AC-VT-7 | Live: a real voice message to the local bot gets the quote + coach reply | orchestrator + owner, local bot |

## Task 1 — Server: port, Gemini adapter, config, route (AC-VT-1..3)

Files: `src/domain/conversation/ports/` (or a new `src/domain/speech/ports.ts` — follow where ports
with DI tokens live), `src/infra/ai/gemini-transcriber.ts`, `src/config/index.ts`,
`src/main/register-infra-services.ts` / bootstrap services decoration, `src/app/types/fastify.d.ts`,
a new `src/app/routes/voice.routes.ts` registered under `/api/bot` like `chat.routes.ts`,
`.env.example`, tests next to the existing ones.

- [x] Red tests for AC-VT-1..3, then the code.
- [x] Verification (from `apps/server/`): `npm run lint && npm run type-check && npm run test:unit` — all green.

## Task 2 — Bot: voice handling and reply format (AC-VT-4..5)

Files: `apps/bot/handlers.ts`, a new `apps/bot/voice.ts` (format helpers + D8 texts, no Telegram
calls), `apps/bot/__tests__/`.

- [x] Red tests for AC-VT-4..5, then the code.
- [x] Verification (from `apps/bot/`): `npx tsc --noEmit && npm test` — all green.

## Task 3 — Fixes from the orchestrator's review and live probes (AC-VT-1, AC-VT-4..6)

Live checks on the local server (2026-09-27): speech → 200 in 1.8 s ✓; 3 s of digital silence → `"700"`
(hallucination); a 300 s clip → 503 after 30 s (timeout). Direct probes: with the R1 instruction, low-level
noise (real-mic-like) → `<NO_SPEECH>` 3/3 and white noise 2/2, but pure digital silence still hallucinates
in 3–4 of 4 with every variant tried (`medium` thinking, JSON `has_speech` schema) — accepted, see Not in
scope. A 147 s natural monologue → full transcript (1915 chars, 609 tokens) in 4.8 s; a looped 300 s clip
runs away to 65k output tokens / 155 s without a cap, and stops at 11.5 s with `maxOutputTokens: 4096`
(`finishReason: MAX_TOKENS`).

- [x] **R1 — no-speech sentinel.** Instruction becomes exactly: `Transcribe the audio verbatim in its original
  language. Output only the transcript text, nothing else. Write numbers as digits. If the audio contains no
  clearly spoken words (silence, noise, music, breathing), output exactly: <NO_SPEECH>. Never guess or invent
  words that are not clearly spoken.` A trimmed transcript equal to `<NO_SPEECH>` (or empty) → `NoSpeechError`.
- [x] **R2 — output cap.** `STT_MAX_OUTPUT_TOKENS` (default 4096) → `generationConfig.maxOutputTokens`.
  `finishReason: MAX_TOKENS` → log warn, return the text as is.
- [x] **R3 — timeout.** `STT_TIMEOUT_MS` default 60000, and the timer also covers reading the body.
- [x] **R4 — log usage (D5).** One info log per successful call: model, latency, `promptTokenCount`,
  `candidatesTokenCount`, `thoughtsTokenCount`, `finishReason`, text length.
- [x] **R5 — bot quote cut.** Cut the raw transcript at 3500 chars, then escape — cutting after escaping
  can split an entity (`&am…`), Telegram rejects the HTML and `sendHtml` falls back to raw tags.
- [x] **R6 — bot accidental taps.** Voice with `duration < 1` → the `NO_SPEECH` notice, no download, no STT call.
- [x] Verification: from `apps/server`: `npm run lint && npm run type-check && npm run test:unit`; from
  `apps/bot`: `npx tsc --noEmit && npm test` — all green.

## Task 4 — Review run 1 code fixes (B2, B3, B5)

- [x] **F1 (B2, covers A10).** In `apps/bot/handlers.ts` extract one helper for the shared chat sequence
  (post `/api/bot/chat`, validate `data.content`, and the failure tail: 404 → clear cached id, `log.error` with
  axios status/responseData, `errorTextFor`), used by the text path, `/start` and the voice path. The voice path
  keeps only its differences (quote-first reply; the quote before the error text). A Telegram send failure after
  a successful chat must not be reported as a chat error. Behaviour of the text and `/start` paths unchanged —
  their existing tests stay green untouched.
- [x] **F2 (B3).** One shared "code of a thrown error against a status map" helper for `chat.routes.ts` and
  `voice.routes.ts` (no special-case `CORE_ERROR` branch; `CORE_ERROR` → 500 lives in the map the voice route uses).
- [x] **F3 (B5).** AC-VT-2 in the describe name of `stt-tunables.unit.test.ts`.
- [x] **F4 (B2, orchestrator review of F1).** The failure tail (404 → clear cached id, `log.error` with axios
  status/responseData, `errorTextFor`) is still written out in `chatAndReply`'s catch and in the outer catches of
  `/start`, the text path and the voice path. One helper for that tail, used by all four; behaviour unchanged.
- [x] Verification: from `apps/server`: `npm run lint && npm run type-check && npm run test:unit`; from `apps/bot`:
  `npx tsc --noEmit && npm test` — all green.

## Verification evidence (2026-09-27)

- Task 1 (worker, 435ca53b): server lint 0 errors, type-check clean, test:unit 150 suites / 1490 tests passed.
- Task 2 (worker, c7df9875): bot `tsc --noEmit` clean, `npm test` 8 suites / 64 tests; server lint 0 errors.
- Task 3 (worker, e4cf9f6f): server test:unit 150 suites / 1496 tests; bot 8 suites / 66 tests; lint/type-check clean.
  Every commit passed `.husky/pre-commit` (lint → format:check → type-check → test:unit).
- AC-VT-6 (orchestrator, local server from this worktree, real key, after Task 3):
  `probe.ogg` 6 s → 200 `"Сегодня сделал три подхода приседа по 8 повторов с весом 60 кг."` 2.2 s;
  low-level noise → 422 `NO_SPEECH` 1.3 s; 147 s monologue → 200 full transcript; looped 300 s clip → 200
  capped (`MAX_TOKENS`) instead of the pre-fix 503 at 30 s; no `X-Api-Key` → 401.
- AC-VT-7: pending — local bot `@MyFitAiCoachTestBot` running from this worktree, awaiting the owner's voice message.

## Orchestrator checks before "ready to merge"

- AC-VT-6: local server with `STT_API_KEY` set in local `apps/server/.env`, `curl` the route with the probe clip.
- AC-VT-7: local bot (third token) + local server; the owner sends a voice message.
- Dev readiness: `STT_API_KEY` present in the VPS `.env.dev` before the merge, otherwise voice replies
  `STT_UNAVAILABLE` after deploy (D2 keeps the deploy itself safe). Durable docs: `API_SPEC.md`
  (new route), feature spec `docs/features/FEAT-0011-voice-messages.md`.
- `close-out-review`.

## Not in scope

- `audio` files, `video_note`, forwarded voice from channels.
- Recording the STT call in `llm_calls` / storing the audio.
- Prod (frozen).
- Pure digital silence (all-zero samples) may still be transcribed as invented words — no real Telegram
  recording is digital zero (mic noise → `<NO_SPEECH>`), and the quote shows the user what was heard.
  Energy-based pre-check (VAD) would need audio decoding (ffmpeg in the image) — not now.

## Review

Run 1 — 2026-09-27, zones R1–R4, verdict **blocked**. Findings relayed verbatim (condensed to their claim).

Blocking:
- B1 | R1 | `apps/server/src/infra/ai/gemini-transcriber.ts:164` | ADR-0007 Guardrail 3; ADR-0013 D-10 — `GeminiTranscriber` calls a model directly, bypassing `getModel(profile)` and the `LlmGateway` port. Owner decision: amend the ADR with a carve-out for non-conversational audio→text, or route through the profile mechanism. → open, asked the owner.
- B2 | R2 | `apps/bot/handlers.ts:176-203` | CONTRIBUTING_AI "Principles & Boundaries" — DRY — the voice path's `/api/bot/chat` post + content check + 404-clear/log/errorTextFor tail is a third copy of the text path (`handlers.ts:386-418`) and `/start` (`:337-369`); the same tail repeats at `:206-212`. → Task 4 F1.
- B3 | R2 | `apps/server/src/app/routes/voice.routes.ts:11-14` | DRY — `speechErrorCodeOf` copies `conversationErrorCodeOf` (`chat.routes.ts:8-11`) and needs an extra `CORE_ERROR ? 500` special case. → Task 4 F2.
- B4 | R3 | plan AC-VT-7 | SUPERPOWERS_INTEGRATION rule 2 — the local-bot live check is pending. → owner's voice message, orchestrator records it.
- B5 | R3 | `apps/server/src/config/__tests__/stt-tunables.unit.test.ts:6` | CONTRIBUTING_AI § ID Conventions — the AC-VT-2 test does not carry its ID. → Task 4 F3.
- B6 | R4 | `docs/STATE.md:14` | Status layer rules 2–3 — `state.mjs --check` fails, STATE not regenerated. → orchestrator.
- B7 | R4 | `docs/features/FEAT-0011-voice-messages.md:3` | Status layer rule 4 — status marker in a durable spec. → orchestrator.
- B8 | R4 | `FEAT-0011:26` | rule of engagement 1; DOCUMENTATION_GUIDE unique IDs — ACs only a pointer to the plan; behaviour rules without IDs. → orchestrator.
- B9 | R4 | `FEAT-0011:5` | DOCUMENTATION_GUIDE § Feature Spec — no Scenarios, API Mapping, Domain Rules Reference. → orchestrator.
- B10 | R4 | `docs/domain/` | DOCUMENTATION_GUIDE § Domain Spec — no spec for the new `domain/speech` port. → orchestrator.
- B11 | R4 | `docs/API_SPEC.md:156` | DOCUMENTATION_GUIDE § API Spec — § 3.2 omits the declared 400. → orchestrator.
- B12 | R4 | `docs/ARCHITECTURE.md:35` | rule of engagement 7 — module layout lacks `domain/speech/` and `infra/ai/gemini-transcriber.ts`. → orchestrator.
- B13 | R4 | this plan, D2/D3/D4/D6 | Division of roles (edit in place) — Decisions disagree with Task 3 (timeout 60000, `STT_MAX_OUTPUT_TOKENS`, `<NO_SPEECH>` sentinel, < 1 s rule). → orchestrator.

Advisory (→ BACKLOG via the `backlog` skill unless a blocking fix removes them):
- A1 | R1 | `gemini-transcriber.ts:20` — STT instruction is an inline constant, not a versioned prompt module (ADR-0013 D-09 applicability unclear).
- A2 | R1 | `domain/speech/errors.ts:45` — HTTP status map in the domain (copies the conversation precedent).
- A3 | R1 | `domain/speech/ports/index.ts:1` — ports index re-exports errors, unlike conversation.
- A4 | R1+R2 | `speech-transcriber.ports.ts:22`, `voice.routes.ts:56-59` — disabled detected twice (`isEnabled()` and the throw).
- A5 | R1 | `apps/bot/handlers.ts:133` — voice IO flow in `handlers.ts` (421 lines).
- A6 | R2 | `domain/speech/errors.ts:42` — unused `SpeechError` union.
- A7 | R2 | `voice.routes.ts:65,68` — latency/text length logged twice (route + adapter).
- A8 | R2 | `apps/bot/voice.ts:68-86` — bilingual record + `ru` rule duplicated from `error-text.ts`.
- A9 | R2 | `gemini-transcriber.ts:102-104` — second usage-reading convention beside `infra/ai/usage.ts`.
- A10 | R3 | `apps/bot/handlers.ts:189` — a Telegram send failure after a successful chat is treated as a chat error (quote twice + misleading error).
- A11 | R3 | `apps/bot/voice.ts:33` — escaping after the 3500 cut can still exceed 4096 for entity-dense text.
- A12 | R3 | `handlers.voice.unit.test.ts:231` — test name claims the 3500 cut but asserts only expandable; unused `chatId`.
- A13 | R3 | `handlers.voice.unit.test.ts:202` — split fixture reply alone exceeds 4096.
- A14 | R3 | `voice.route.unit.test.ts:41`, `voice.unit.test.ts:23/96` — AC IDs only in header comments.
- A15 | R3 | `voice.routes.ts:68` — `NoSpeechError` logged at error level.
- A16 | R4 | `domain/speech/errors.ts:12`, `speech-transcriber.ports.ts:24` — JSDoc predates the sentinel.
- A17 | R4 | `docs/ARCHITECTURE.md:333` — error-code table lacks NO_SPEECH/STT_UNAVAILABLE.
- A18 | R4 | `CLAUDE.md` LLM section — `STT_API_KEY` in `.env.dev` not mentioned.

Meta (→ `docs/REVIEW_FINDINGS.md`): R1 blind spot (ADR-0007 guardrails not listed as in force); R1 rule candidate
(every model invocation through the model factory); R2 rule candidate (third copy of duplicated code is a violation);
R3+R4 plan-local `AC-<SLUG>-n` IDs undefined; R3 blind spot (AC ID in header comment vs describe/it); R4 rule
candidate (no Status line in feature specs).
