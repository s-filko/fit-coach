import { useState, createContext, useContext, useMemo } from 'react';
import { AppRoot } from '@telegram-apps/telegram-ui';
import { RouterProvider } from 'react-router/dom';

import { router } from './app/router';

type Appearance = 'light' | 'dark';

interface ThemeContextValue {
  appearance: Appearance;
}

export const ThemeContext = createContext<ThemeContextValue>({
  appearance: 'dark',
});

export function useTheme() {
  return useContext(ThemeContext);
}

function detectAppearance(): Appearance {
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--tg-theme-bg-color')
    .trim();

  if (!bg) return 'dark';

  const hex = bg.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5 ? 'light' : 'dark';
}

export function App() {
  const [appearance] = useState<Appearance>(detectAppearance);

  const ctx = useMemo<ThemeContextValue>(() => ({ appearance }), [appearance]);

  return (
    <ThemeContext.Provider value={ctx}>
      <AppRoot appearance={appearance} style={{ minHeight: '100vh' }}>
        <RouterProvider router={router} />
      </AppRoot>
    </ThemeContext.Provider>
  );
}
