/**
 * SpeechTranscriberPort (voice-transcription plan, D1): the one speech-to-text
 * port. The app layer calls it through `app.services.speechTranscriber`; the
 * provider (today Google AI Studio `generateContent`, see `infra/ai/gemini-transcriber.ts`)
 * lives entirely behind the adapter. Swapping providers later is a new adapter,
 * nothing else.
 */
export interface TranscribeInput {
  /** Voice audio, base64-encoded (Telegram voice is OGG/Opus). */
  audioBase64: string;
  /** RFC mime type of the audio, e.g. `audio/ogg`. */
  mimeType: string;
}

export interface TranscribeResult {
  /** Verbatim transcript in the audio's original language, trimmed. */
  text: string;
}

export interface SpeechTranscriberPort {
  /** False when STT is disabled (D2: AISTUDIO_API_KEY unset) — the caller answers 503 without calling. */
  isEnabled(): boolean;
  /**
   * Transcribes the audio. Throws `NoSpeechError` for an empty transcript and
   * `SttUnavailableError` when disabled, the provider fails or the response is
   * unreadable — never a raw provider error.
   */
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

export const SPEECH_TRANSCRIBER_TOKEN = Symbol('SpeechTranscriber');
