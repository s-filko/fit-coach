import { errorTextFor } from '../error-text';

const CODES = ['LLM_UNAVAILABLE', 'THREAD_BUSY', 'USER_NOT_FOUND', 'CORE_ERROR'] as const;

describe('errorTextFor (AC-1354, D-F)', () => {
    it.each(CODES)('AC-1354: %s — ru returns the ru string, en/undefined/other returns the en string', (code) => {
        const ru = errorTextFor(code, 'ru');
        const enExplicit = errorTextFor(code, 'en');
        const enUndefined = errorTextFor(code, undefined);
        const enOther = errorTextFor(code, 'de');

        expect(ru).not.toBe(enExplicit);
        expect(enExplicit).toBe(enUndefined);
        expect(enExplicit).toBe(enOther);
    });

    it('AC-1354: an unknown or absent code returns the generic fallback in the right language', () => {
        const ruFallback = errorTextFor(undefined, 'ru');
        const enFallback = errorTextFor('SOMETHING_UNKNOWN', 'en');
        const ruFallbackForUnknownCode = errorTextFor('SOMETHING_ELSE_UNKNOWN', 'ru');

        expect(ruFallback).toBe(ruFallbackForUnknownCode);
        expect(enFallback).not.toBe(ruFallback);
    });

    it('AC-1354: no two codes share a string — including the generic fallback, in either language', () => {
        const allCodes = [...CODES, undefined] as const;
        const ruTexts = allCodes.map((code) => errorTextFor(code, 'ru'));
        const enTexts = allCodes.map((code) => errorTextFor(code, 'en'));

        expect(new Set(ruTexts).size).toBe(ruTexts.length);
        expect(new Set(enTexts).size).toBe(enTexts.length);
    });
});
