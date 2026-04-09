import { useState, createContext, useContext, useCallback, useEffect } from 'react';
import { AppRoot } from '@telegram-apps/telegram-ui';
import { RouterProvider } from 'react-router/dom';

import { router } from './app/router';

type Appearance = 'light' | 'dark';

interface ThemeContextValue {
  appearance: Appearance;
  toggle: () => void;
}

const DEFAULT_APPEARANCE: Appearance = 'dark';

export const ThemeContext = createContext<ThemeContextValue>({
  appearance: DEFAULT_APPEARANCE,
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const themes: Record<Appearance, Record<string, string>> = {
  light: {
    '--tg-theme-bg-color': '#ffffff',
    '--tg-theme-text-color': '#000000',
    '--tg-theme-hint-color': '#999999',
    '--tg-theme-link-color': '#2481cc',
    '--tg-theme-button-color': '#5288c1',
    '--tg-theme-button-text-color': '#ffffff',
    '--tg-theme-secondary-bg-color': '#f0f0f0',
    '--tg-theme-header-bg-color': '#ffffff',
    '--tg-theme-section-bg-color': '#ffffff',
    '--tg-theme-section-header-text-color': '#2481cc',
    '--tg-theme-subtitle-text-color': '#999999',
    '--tg-theme-accent-text-color': '#2481cc',
    '--tg-theme-destructive-text-color': '#ec3942',
  },
  dark: {
    '--tg-theme-bg-color': '#212121',
    '--tg-theme-text-color': '#ffffff',
    '--tg-theme-hint-color': '#aaaaaa',
    '--tg-theme-link-color': '#2990ff',
    '--tg-theme-button-color': '#2990ff',
    '--tg-theme-button-text-color': '#ffffff',
    '--tg-theme-secondary-bg-color': '#0f0f0f',
    '--tg-theme-header-bg-color': '#212121',
    '--tg-theme-section-bg-color': '#212121',
    '--tg-theme-section-header-text-color': '#aaaaaa',
    '--tg-theme-subtitle-text-color': '#aaaaaa',
    '--tg-theme-accent-text-color': '#2990ff',
    '--tg-theme-destructive-text-color': '#e53935',
  },
};

function applyThemeVars(appearance: Appearance) {
  const vars = themes[appearance];
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  document.body.style.backgroundColor = vars['--tg-theme-bg-color'];
  document.body.style.color = vars['--tg-theme-text-color'];
}

export function App() {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  const toggle = useCallback(() => {
    setAppearance((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  useEffect(() => applyThemeVars(appearance), [appearance]);

  return (
    <ThemeContext.Provider value={{ appearance, toggle }}>
      <AppRoot appearance={appearance} style={{ minHeight: '100vh' }}>
        <RouterProvider router={router} />
      </AppRoot>
    </ThemeContext.Provider>
  );
}
