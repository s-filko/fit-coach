import { createHmac } from 'node:crypto';

import { validateInitData, verifyHmac, isAuthDateExpired, parseUser } from '../init-data';

const TEST_BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

function buildInitData(
  overrides: Partial<{
    user: Record<string, unknown>;
    authDate: number;
    botToken: string;
  }> = {},
): string {
  const token = overrides.botToken ?? TEST_BOT_TOKEN;
  const authDate = overrides.authDate ?? Math.floor(Date.now() / 1000);
  const user = JSON.stringify(overrides.user ?? { id: 42, first_name: 'Test', username: 'tester' });

  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('user', user);

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  params.set('hash', hash);
  return params.toString();
}

describe('validateInitData', () => {
  it('accepts valid initData with correct HMAC', () => {
    const raw = buildInitData();
    const result = validateInitData(raw, TEST_BOT_TOKEN);

    expect(result.valid).toBe(true);
    expect(result.telegramUserId).toBe(42);
    expect(result.firstName).toBe('Test');
    expect(result.username).toBe('tester');
  });

  it('rejects initData signed with wrong token', () => {
    const raw = buildInitData({ botToken: 'wrong-token' });
    const result = validateInitData(raw, TEST_BOT_TOKEN);

    expect(result.valid).toBe(false);
  });

  it('rejects tampered initData', () => {
    const raw = buildInitData();
    const tampered = raw.replace('tester', 'hacker');
    const result = validateInitData(tampered, TEST_BOT_TOKEN);

    expect(result.valid).toBe(false);
  });

  it('rejects expired auth_date', () => {
    const expired = Math.floor(Date.now() / 1000) - 90000;
    const raw = buildInitData({ authDate: expired });
    const result = validateInitData(raw, TEST_BOT_TOKEN);

    expect(result.valid).toBe(false);
  });

  it('rejects initData without hash', () => {
    const params = new URLSearchParams();
    params.set('auth_date', String(Math.floor(Date.now() / 1000)));
    params.set('user', JSON.stringify({ id: 1 }));

    const result = validateInitData(params.toString(), TEST_BOT_TOKEN);
    expect(result.valid).toBe(false);
  });

  it('rejects initData without user field', () => {
    const params = new URLSearchParams();
    params.set('auth_date', String(Math.floor(Date.now() / 1000)));

    const secretKey = createHmac('sha256', 'WebAppData').update(TEST_BOT_TOKEN).digest();
    const dataCheckString = `auth_date=${params.get('auth_date')}`;
    const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    params.set('hash', hash);

    const result = validateInitData(params.toString(), TEST_BOT_TOKEN);
    expect(result.valid).toBe(false);
  });

  it('rejects initData with non-numeric user id', () => {
    const raw = buildInitData({ user: { id: 'not-a-number', first_name: 'Bad' } });
    const result = validateInitData(raw, TEST_BOT_TOKEN);

    expect(result.valid).toBe(false);
  });
});

describe('verifyHmac', () => {
  it('returns true for matching HMAC', () => {
    const params = new URLSearchParams();
    params.set('auth_date', '1234567890');
    params.set('user', JSON.stringify({ id: 1 }));

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(TEST_BOT_TOKEN).digest();
    const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    expect(verifyHmac(params, hash, TEST_BOT_TOKEN)).toBe(true);
  });

  it('returns false for mismatched HMAC', () => {
    const params = new URLSearchParams();
    params.set('auth_date', '1234567890');

    expect(verifyHmac(params, 'deadbeef'.repeat(8), TEST_BOT_TOKEN)).toBe(false);
  });
});

describe('isAuthDateExpired', () => {
  it('returns false for fresh auth_date', () => {
    const params = new URLSearchParams();
    params.set('auth_date', String(Math.floor(Date.now() / 1000)));
    expect(isAuthDateExpired(params)).toBe(false);
  });

  it('returns true for old auth_date', () => {
    const params = new URLSearchParams();
    params.set('auth_date', String(Math.floor(Date.now() / 1000) - 90000));
    expect(isAuthDateExpired(params)).toBe(true);
  });

  it('returns false when auth_date is missing', () => {
    const params = new URLSearchParams();
    expect(isAuthDateExpired(params)).toBe(false);
  });
});

describe('parseUser', () => {
  it('parses valid user JSON', () => {
    const params = new URLSearchParams();
    params.set(
      'user',
      JSON.stringify({
        id: 99,
        first_name: 'Alice',
        last_name: 'Smith',
        username: 'alice',
        language_code: 'en',
      }),
    );

    const result = parseUser(params);
    expect(result).toEqual({
      valid: true,
      telegramUserId: 99,
      firstName: 'Alice',
      lastName: 'Smith',
      username: 'alice',
      languageCode: 'en',
    });
  });

  it('returns invalid for missing user', () => {
    const params = new URLSearchParams();
    expect(parseUser(params).valid).toBe(false);
  });

  it('returns invalid for malformed JSON', () => {
    const params = new URLSearchParams();
    params.set('user', '{bad json');
    expect(parseUser(params).valid).toBe(false);
  });
});
