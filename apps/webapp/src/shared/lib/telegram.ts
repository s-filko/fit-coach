import { retrieveLaunchParams } from '@tma.js/sdk-react';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export function getTelegramUser(): TelegramUser | null {
  try {
    const lp = retrieveLaunchParams();
    const data = lp.tgWebAppData;
    if (data && typeof data === 'object' && 'user' in data) {
      return (data as { user?: TelegramUser }).user ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
