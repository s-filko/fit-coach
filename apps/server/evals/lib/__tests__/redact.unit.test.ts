import { pseudonymise, redactText, redactUser } from '../redact';

describe('pseudonymise', () => {
  it('is stable for the same user id', () => {
    expect(pseudonymise('abc')).toBe(pseudonymise('abc'));
  });

  it('differs between users', () => {
    expect(pseudonymise('abc')).not.toBe(pseudonymise('xyz'));
  });

  it('never contains the original id', () => {
    expect(pseudonymise('11111111-1111-4111-8111-111111111111')).not.toContain('11111111');
  });
});

describe('redactText', () => {
  it('replaces the user first name wherever it appears', () => {
    expect(redactText('Привет, Сергей! Как дела, Сергей?', 'Сергей')).toBe('Привет, [NAME]! Как дела, [NAME]?');
  });

  it('is case-insensitive about the name', () => {
    expect(redactText('привет сергей', 'Сергей')).toBe('привет [NAME]');
  });

  it('removes email addresses', () => {
    expect(redactText('пиши на a.b@example.com', null)).toBe('пиши на [EMAIL]');
  });

  it('removes phone-like number runs', () => {
    expect(redactText('мой номер +49 170 1234567', null)).toContain('[PHONE]');
  });

  it('keeps training numbers intact', () => {
    expect(redactText('жим 80 на 8', null)).toBe('жим 80 на 8');
  });

  it('handles a null name without throwing', () => {
    expect(redactText('привет', null)).toBe('привет');
  });
});

describe('redactUser', () => {
  it('keeps only the fields a fixture needs', () => {
    const result = redactUser({
      id: 'u1',
      firstName: 'Сергей',
      lastName: 'Петров',
      username: 'sergey',
      languageCode: 'ru',
      timezone: 'Europe/Berlin',
      age: 34,
      weight: '84.5',
    });
    expect(result).toEqual({ languageCode: 'ru', timezone: 'Europe/Berlin', age: 34, weight: '84.5' });
    expect(Object.keys(result)).not.toContain('firstName');
    expect(Object.keys(result)).not.toContain('username');
  });
});
