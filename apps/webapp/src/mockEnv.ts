import { emitEvent, isTMA, mockTelegramEnv } from '@tma.js/sdk-react';

if (import.meta.env.DEV) {
  if (!(await isTMA('complete'))) {
    const themeParams = {
      accent_text_color: '#2990ff',
      bg_color: '#212121',
      button_color: '#2990ff',
      button_text_color: '#ffffff',
      destructive_text_color: '#e53935',
      header_bg_color: '#212121',
      hint_color: '#aaaaaa',
      link_color: '#2990ff',
      secondary_bg_color: '#0f0f0f',
      section_bg_color: '#212121',
      section_header_text_color: '#aaaaaa',
      subtitle_text_color: '#aaaaaa',
      text_color: '#ffffff',
    } as const;

    const noInsets = { left: 0, top: 0, bottom: 0, right: 0 } as const;

    mockTelegramEnv({
      onEvent(e) {
        if (e.name === 'web_app_request_theme') {
          return emitEvent('theme_changed', { theme_params: themeParams });
        }
        if (e.name === 'web_app_request_viewport') {
          return emitEvent('viewport_changed', {
            height: window.innerHeight,
            width: window.innerWidth,
            is_expanded: true,
            is_state_stable: true,
          });
        }
        if (e.name === 'web_app_request_content_safe_area') {
          return emitEvent('content_safe_area_changed', noInsets);
        }
        if (e.name === 'web_app_request_safe_area') {
          return emitEvent('safe_area_changed', noInsets);
        }
      },
      launchParams: new URLSearchParams([
        ['tgWebAppThemeParams', JSON.stringify(themeParams)],
        ['tgWebAppData', new URLSearchParams([
          ['auth_date', (Date.now() / 1000 | 0).toString()],
          ['hash', 'mock_hash'],
          ['signature', 'mock_signature'],
          ['user', JSON.stringify({
            id: 1,
            first_name: 'Dev',
            last_name: 'User',
            username: 'devuser',
            language_code: 'ru',
          })],
        ]).toString()],
        ['tgWebAppVersion', '8.4'],
        ['tgWebAppPlatform', 'tdesktop'],
      ]),
    });
  }
}
