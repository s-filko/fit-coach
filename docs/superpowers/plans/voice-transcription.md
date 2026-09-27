# Voice Transcription — Telegram Voice Messages Answered as Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first, then the code.

- Status: planned
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
  (default 30000). Tunables-not-secrets exception, same class as `EPISODE_*`. `.env.example` documents them.
- **D3 — route.** `POST /api/bot/voice/transcribe`, `X-Api-Key` auth like every `/api/bot` route,
  body `{userId, audioBase64, mimeType}`, route-level `bodyLimit` 15 MiB.
  `200 {data:{text}}`; `422 {error:{code:'NO_SPEECH'}}` when the transcript is empty after trim;
  `503 {error:{code:'STT_UNAVAILABLE'}}` when STT is disabled, the provider errors or times out.
  The body never carries the provider's message (INV-LLM-006 style); logs do.
- **D4 — instruction.** One constant: transcribe verbatim in the original language, output only
  the transcript, write numbers as digits, empty output if there is no intelligible speech.
  `temperature: 0`, `thinkingLevel: "low"`.
- **D5 — the transcript is the user's message.** The bot sends the transcript to the existing
  `/api/bot/chat` unchanged — the conversation, audit trail (`llm_calls`, transcript) and prompts do
  not change. The STT call itself is logged (userId, model, latency, audio/output tokens, text length),
  not written to `llm_calls` (run-scoped table; a pre-run call has no run).
- **D6 — bot flow for `msg.voice`.** Inside the same `chatQueue` + `withTypingIndicator`:
  duration > 300 s → localized "too long" text, no download; else download via
  `bot.getFileStream(file_id)` (or `getFileLink` + axios) → base64 → transcribe → on success
  `/api/bot/chat` with the transcript → reply. Voice only: `audio`, `video_note`, documents are out of scope.
- **D7 — reply format.** One message: `<blockquote>🎤 {escapeHtml(transcript)}</blockquote>\n\n{coachReply}`
  through the existing `sendHtml`. Transcript > 500 chars → `<blockquote expandable>`; the displayed
  quote is cut at 3500 chars with `…` (the coach always gets the full text). If the composed message
  exceeds Telegram's 4096 chars, the quote goes as its own message first, then the reply.
  Empty coach reply → only the quote is sent (the user still sees what was heard).
- **D8 — failure texts (en/ru, profile language like `errorTextFor`).** `NO_SPEECH`: couldn't make out
  the voice message, try again or type it; `STT_UNAVAILABLE`: voice recognition is unavailable right
  now, please type; too long: voice messages up to 5 minutes. Chat errors after a successful
  transcription keep today's `errorTextFor` path, preceded by the quote so the user sees what was heard.
- **D9 — executor:** GLM worker, two tasks in one terminal (server, then bot).

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

- [ ] **R1 — no-speech sentinel.** Instruction becomes exactly: `Transcribe the audio verbatim in its original
  language. Output only the transcript text, nothing else. Write numbers as digits. If the audio contains no
  clearly spoken words (silence, noise, music, breathing), output exactly: <NO_SPEECH>. Never guess or invent
  words that are not clearly spoken.` A trimmed transcript equal to `<NO_SPEECH>` (or empty) → `NoSpeechError`.
- [ ] **R2 — output cap.** `STT_MAX_OUTPUT_TOKENS` (default 4096) → `generationConfig.maxOutputTokens`.
  `finishReason: MAX_TOKENS` → log warn, return the text as is.
- [ ] **R3 — timeout.** `STT_TIMEOUT_MS` default 60000, and the timer also covers reading the body.
- [ ] **R4 — log usage (D5).** One info log per successful call: model, latency, `promptTokenCount`,
  `candidatesTokenCount`, `thoughtsTokenCount`, `finishReason`, text length.
- [ ] **R5 — bot quote cut.** Cut the raw transcript at 3500 chars, then escape — cutting after escaping
  can split an entity (`&am…`), Telegram rejects the HTML and `sendHtml` falls back to raw tags.
- [ ] **R6 — bot accidental taps.** Voice with `duration < 1` → the `NO_SPEECH` notice, no download, no STT call.
- [ ] Verification: from `apps/server`: `npm run lint && npm run type-check && npm run test:unit`; from
  `apps/bot`: `npx tsc --noEmit && npm test` — all green.

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
