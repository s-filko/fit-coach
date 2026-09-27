/**
 * errorCodeOf (voice-transcription plan Task 4, F2/B3): the one duck-typed
 * "code of a thrown error against a status map" check shared by
 * chat.routes.ts and voice.routes.ts — the map doubles as the allowed-code set.
 */
import { errorCodeOf } from '../route-error';

const STATUSES = { NO_SPEECH: 422, STT_UNAVAILABLE: 503, CORE_ERROR: 500 } as const;

describe('errorCodeOf (F2)', () => {
  it('returns the code when it is a key of the map', () => {
    expect(errorCodeOf(new Error('x'), STATUSES)).toBeUndefined();
    expect(errorCodeOf({ code: 'NO_SPEECH' }, STATUSES)).toBe('NO_SPEECH');
    expect(errorCodeOf({ code: 'CORE_ERROR' }, STATUSES)).toBe('CORE_ERROR');
  });

  it('returns undefined for a code outside the map', () => {
    expect(errorCodeOf({ code: 'SOMETHING_ELSE' }, STATUSES)).toBeUndefined();
  });

  it('returns undefined for a missing or non-string code and never throws', () => {
    expect(errorCodeOf({}, STATUSES)).toBeUndefined();
    expect(errorCodeOf({ code: 42 }, STATUSES)).toBeUndefined();
    expect(errorCodeOf(null, STATUSES)).toBeUndefined();
    expect(errorCodeOf('CORE_ERROR', STATUSES)).toBeUndefined();
    expect(errorCodeOf(undefined, STATUSES)).toBeUndefined();
  });
});
