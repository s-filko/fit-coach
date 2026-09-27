Domain: Speech

Terms
	• Voice message: a Telegram voice note (OGG/Opus), duration in whole seconds
	• Transcript: the verbatim text of the speech in the voice message, in its original language

Invariants
	• INV-SPEECH-001: The transcriber only converts audio to text — it writes nothing, stores no audio and never touches the conversation; the transcript enters the conversation only as the user's message via `/api/bot/chat` [BR-SPEECH-003]
	• INV-SPEECH-002: The provider key lives only in the server; the bot never holds it [ADR-0013 §7 amendment 2026-09-27]
	• INV-SPEECH-003: An HTTP error body carries only `code` (NO_SPEECH | STT_UNAVAILABLE | CORE_ERROR), never a provider or exception message [INV-LLM-006]

Business Rules
	• BR-SPEECH-001: A voice message shorter than 1 s is an accidental tap → the NO_SPEECH notice; longer than 300 s → the too-long notice; neither is downloaded or transcribed
	• BR-SPEECH-002: No clearly spoken words (the provider answers the `<NO_SPEECH>` sentinel, or an empty text) → NO_SPEECH; the conversation is not called
	• BR-SPEECH-003: A transcript is sent to the conversation unchanged, exactly as if the user had typed it
	• BR-SPEECH-004: The reply starts with the transcript as a quote (`🎤`), then the coach's answer, in one message when it fits Telegram's 4096 chars, otherwise the quote first; an empty coach answer sends the quote alone; every voice reply and voice notice is sent as a Telegram reply to the voice note
	• BR-SPEECH-005: The displayed quote is cut at 3500 raw chars (then escaped); over 500 chars it is expandable; the coach always receives the full transcript
	• BR-SPEECH-006: STT disabled (no key), a provider error or timeout → STT_UNAVAILABLE notice; a conversation error after a successful transcription → the quote, then the usual conversation error text
	• BR-SPEECH-007: Notices use the user's profile language (ru → Russian, anything else → English), the same rule as conversation error texts

Ports
	• SpeechTranscriberPort (SPEECH_TRANSCRIBER_TOKEN)
	• isEnabled(): boolean — false when no provider key is configured [BR-SPEECH-006]
	• transcribe({ audioBase64, mimeType }): { text } — throws NoSpeechError [BR-SPEECH-002] or SttUnavailableError [BR-SPEECH-006]

Rules:
- Matches `apps/server/src/domain/speech/ports/speech-transcriber.ports.ts` and `domain/speech/errors.ts`.
- Adapter: `infra/ai/gemini-transcriber.ts` (Google AI Studio `generateContent`, `STT_*` config).
