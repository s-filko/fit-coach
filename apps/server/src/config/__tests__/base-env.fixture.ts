// Shared minimal-valid-env fixture for config unit tests.
// Not a test file (jest testMatch only picks up *.unit.test.ts) — import, don't extend.
export const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '3000',
  HOST: '0.0.0.0',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'db',
  BOT_API_KEY: 'k',
  TELEGRAM_TOKEN: 't',
  LLM_API_KEY: 'k',
  LLM_MODEL: 'm',
  LLM_TEMPERATURE: '0.7',
};
