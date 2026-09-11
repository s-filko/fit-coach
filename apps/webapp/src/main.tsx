import './mockEnv';

import '@telegram-apps/telegram-ui/dist/styles.css';

import ReactDOM from 'react-dom/client';
import { StrictMode } from 'react';

import { App } from './App';
import { ErrorBoundary } from './shared/ui/ErrorBoundary';
import { initTelegramSdk } from './init';

import './index.css';

try {
  initTelegramSdk(import.meta.env.DEV);
} catch (e) {
  console.warn('Telegram SDK init failed:', e);
}

ReactDOM
  .createRoot(document.getElementById('root')!)
  .render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
