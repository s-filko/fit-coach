import {
  init as sdkInit,
  backButton,
  miniApp,
  viewport,
  setDebug,
} from '@tma.js/sdk-react';

export function initTelegramSdk(debug: boolean): void {
  if (debug) {
    setDebug(true);
  }

  sdkInit();

  miniApp.mount();
  backButton.mount();

  try {
    viewport.mount();

    if (!viewport.isExpanded()) {
      viewport.expand();
    }
  } catch {
    // viewport methods may fail outside Telegram WebView
  }

  miniApp.ready();
}
