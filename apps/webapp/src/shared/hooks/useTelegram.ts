import { useMemo } from 'react';
import {
  retrieveLaunchParams,
  backButton,
  mainButton,
  viewport,
} from '@tma.js/sdk-react';

function getLaunchParamsSafe() {
  try {
    return retrieveLaunchParams();
  } catch {
    return null;
  }
}

function getViewportHeight(): number | null {
  try {
    return viewport.height();
  } catch {
    return null;
  }
}

export function useTelegram() {
  const launchParams = useMemo(getLaunchParamsSafe, []);
  const user = launchParams?.tgWebAppData &&
    typeof launchParams.tgWebAppData === 'object' &&
    'user' in launchParams.tgWebAppData
    ? (launchParams.tgWebAppData as { user?: { id: number; first_name?: string; last_name?: string; username?: string } }).user
    : null;

  return useMemo(
    () => ({
      user,
      viewportHeight: getViewportHeight(),
      backButton,
      mainButton,
      platform: launchParams?.tgWebAppPlatform ?? null,
    }),
    [user, launchParams?.tgWebAppPlatform],
  );
}
