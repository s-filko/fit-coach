# FEAT-0011: Voice Messages

## User Story

As a user, I want to send a Telegram voice message instead of typing, and see what the bot heard
before the coach's answer, so that I can talk to the coach hands-free during a workout.

## Scenarios

- **S-0117 (happy path):** the user sends a 6 s voice note "Сегодня сделал три подхода приседа…" →
  the bot replies with one message: `🎤 Сегодня сделал три подхода приседа по 8 повторов с весом 60 кг.` as a quote,
  then the coach's answer to that text. [BR-SPEECH-003][BR-SPEECH-004]
- **S-0118 (long transcript):** a 2–5 min monologue → the quote is expandable, cut at 3500 chars for display;
  the coach receives the full text; if quote + answer exceed 4096 chars they arrive as two messages, quote first. [BR-SPEECH-004][BR-SPEECH-005]
- **S-0119 (no speech):** a voice note with only background noise → "couldn't make out the voice message, try again
  or type it"; the coach is not called. [BR-SPEECH-002]
- **S-0120 (accidental tap / too long):** a voice note under 1 s → the same no-speech notice; over 5 min → "voice
  messages up to 5 minutes"; nothing is downloaded. [BR-SPEECH-001]
- **S-0121 (STT unavailable):** no key configured, provider error or timeout → "voice recognition is unavailable right
  now, please type". [BR-SPEECH-006]
- **S-0122 (coach error after transcription):** the transcription succeeds, the conversation fails → the quote, then the
  usual conversation error text in the user's language. [BR-SPEECH-006][BR-SPEECH-007]

## Acceptance Criteria

- **AC-1415:** a voice note is transcribed and its transcript is the user's message to `/api/bot/chat`, unchanged (S-0117).
- **AC-1416:** the reply is quote + coach answer per BR-SPEECH-004/005 — HTML-escaped, expandable over 500 chars,
  display cut at 3500, split over 4096, quote alone on an empty answer (S-0117, S-0118).
- **AC-1417:** `<NO_SPEECH>` or an empty transcript → 422 `NO_SPEECH`, the no-speech notice, no chat call (S-0119).
- **AC-1418:** < 1 s and > 300 s voice notes are answered without download or STT call (S-0120).
- **AC-1419:** STT disabled / provider error / timeout → 503 `STT_UNAVAILABLE`, the unavailable notice; the server
  boots without `AISTUDIO_API_KEY` (S-0121).
- **AC-1420:** a conversation error after a successful transcription sends the quote, then `errorTextFor` (S-0122).
- **AC-1421:** error bodies of the transcribe route carry only `code` (INV-SPEECH-003).

Plan-level criteria and their tests: `docs/superpowers/plans/voice-transcription.md` (AC-VT-1..7); the durable ↔ plan ↔ test mapping is the table in its § Verification evidence.

## API Mapping

- `POST /api/bot/voice/transcribe` — API_SPEC § 3.2 (transcription only).
- `POST /api/bot/chat` — API_SPEC § 3.1 (the transcript as the user's message).

## Domain Rules Reference

- `docs/domain/speech.spec.md` — INV-SPEECH-001..003, BR-SPEECH-001..007.
- ADR-0013 §7, amendment 2026-09-27 — speech-to-text is a media capability behind its own port, not an LLM access path.

## Known limits

- A voice note without speech (silence, background noise) can be transcribed as invented words — model behaviour
  measured 2026-09-27 despite the `<NO_SPEECH>` instruction; the quote makes any mis-hearing visible. Removal is a
  backlog item.
- The STT call is logged (model, latency, tokens, finish reason), not written to `llm_calls`; the audio is not stored.
