import { classifyError, ERROR_MESSAGE_MAX_CHARS } from '../classify-error';

describe('classifyError (the one error-shape policy, shared by conversation_runs and llm_calls)', () => {
  it('names the constructor and keeps the message, for an Error subclass', () => {
    class UpstreamError extends Error {}
    const { errorClass, errorMessage } = classifyError(new UpstreamError('upstream 503'));
    expect(errorClass).toBe('UpstreamError');
    expect(errorMessage).toBe('upstream 503');
  });

  it('handles a non-Error throw without crashing', () => {
    expect(classifyError('a plain string failure')).toEqual({
      errorClass: 'string',
      errorMessage: 'a plain string failure',
    });
  });

  it('truncates a long message, keeping the class name intact', () => {
    const longMessage = 'x'.repeat(2000);
    const { errorClass, errorMessage } = classifyError(new Error(longMessage));
    expect(errorClass).toBe('Error');
    expect(errorMessage.length).toBeLessThan(longMessage.length);
    expect(errorMessage.startsWith('x'.repeat(ERROR_MESSAGE_MAX_CHARS))).toBe(true);
  });

  it('leaves a short message untouched, byte for byte', () => {
    expect(classifyError(new Error('short')).errorMessage).toBe('short');
  });
});
