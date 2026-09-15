import { createHmac } from 'node:crypto';

/**
 * Builds a Telegram WebApp initData string signed with the bot token —
 * the same algorithm validateInitData() checks (src/app/middlewares/init-data.ts).
 * Lifted from src/app/middlewares/__tests__/init-data.unit.test.ts so integration
 * tests can authenticate against /api/app/* routes.
 */
export function buildSignedInitData(
  botToken: string,
  overrides: Partial<{ user: Record<string, unknown>; authDate: number }> = {},
): string {
  const authDate = overrides.authDate ?? Math.floor(Date.now() / 1000);
  const user = JSON.stringify(overrides.user ?? { id: 424242, first_name: 'Retired', username: 'retired_test' });

  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('user', user);

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  params.set('hash', hash);
  return params.toString();
}
