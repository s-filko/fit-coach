# FEAT-0011: Voice Messages

**Status**: ✅ Implemented (plan `voice-transcription`, 2026-09-27)

## User Story

As a user, I want to send a Telegram voice message instead of typing, and see what the bot heard
before the coach's answer, so that I can talk to the coach hands-free during a workout.

## Behaviour

1. The bot receives `msg.voice` (voice notes only — audio files, video notes and documents are ignored as before).
2. Duration < 1 s → "couldn't make out" notice (accidental tap). Duration > 300 s → "up to 5 minutes" notice. No download in either case.
3. Otherwise the bot downloads the OGG/Opus file and calls `POST /api/bot/voice/transcribe` (API_SPEC § 3.2).
4. The transcript is sent to `POST /api/bot/chat` unchanged — the conversation, memory and audit trail
   treat it exactly like typed text.
5. The reply is one message: `<blockquote>🎤 transcript</blockquote>` then the coach's answer. A transcript
   over 500 chars renders as an expandable quote; the displayed quote is cut at 3500 chars; a composed
   message over 4096 chars is sent as two messages (quote first). An empty coach reply sends the quote alone.
6. Failures, in the user's profile language: `NO_SPEECH` → "couldn't make out, try again or type";
   `STT_UNAVAILABLE` → "voice recognition unavailable, please type"; a chat error after a successful
   transcription → the quote, then the usual error text.

## Acceptance Criteria

AC-VT-1..7 in `docs/superpowers/plans/voice-transcription.md`.

## Known limits

- Pure digital silence can be transcribed as invented words (model behaviour, live probes 2026-09-27);
  a real microphone recording with no speech answers `NO_SPEECH`. The quote makes any mis-hearing visible.
- The STT call is logged (model, latency, tokens, finish reason) but not written to `llm_calls`; the audio is not stored.
