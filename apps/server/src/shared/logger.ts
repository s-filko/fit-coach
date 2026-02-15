import pino from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const NODE_ENV = process.env.NODE_ENV ?? 'development';

// Per-module log level overrides via LOG_LEVEL_<MODULE> env vars
// Example: LOG_LEVEL_LLM=debug -> module "llm" logs at debug level
const MODULE_LEVELS: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  const match = key.match(/^LOG_LEVEL_(.+)$/);
  if (match && value) {
    MODULE_LEVELS[match[1].toLowerCase()] = value;
  }
}

/**
 * Root Pino logger instance.
 * 
 * ARCHITECTURAL NOTE: This is a shared singleton, which is an intentional exception
 * to the "no shared singletons" rule (ADR-0008). Logging is a cross-cutting concern
 * that needs to be available to all layers without creating circular dependencies.
 * 
 * Security: Automatically redacts sensitive fields (passwords, tokens, API keys, etc.)
 * to prevent accidental logging of credentials.
 */
export const rootLogger = pino({
  level: LOG_LEVEL,
  transport: NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      '*.password',
      '*.apiKey',
      '*.token',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
});

/**
 * Logger type for dependency injection.
 * Use this type in domain service interfaces to accept loggers without coupling to Pino.
 */
export type Logger = pino.Logger;

/**
 * Creates a child logger for a specific module.
 * 
 * @param module - Module name (e.g., 'llm', 'chat', 'training', 'bot')
 * @returns Child logger with module label and optional per-module log level
 * 
 * @example
 * ```typescript
 * const log = createLogger('llm');
 * log.info({ model, latency }, 'LLM call completed');
 * ```
 * 
 * Per-module log levels can be set via environment variables:
 * - LOG_LEVEL_LLM=debug -> only LLM module logs at debug level
 * - LOG_LEVEL_CHAT=trace -> only chat module logs at trace level
 */
export function createLogger(module: string): Logger {
  const child = rootLogger.child({ module });
  const moduleLevel = MODULE_LEVELS[module];
  if (moduleLevel) {
    child.level = moduleLevel;
  }
  return child;
}
