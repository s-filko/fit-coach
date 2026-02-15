import pino from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const NODE_ENV = process.env.NODE_ENV ?? 'development';

/**
 * Bot logger with module label.
 * Uses pino for structured logging with automatic JSON formatting in production
 * and pretty-printing in development.
 */
export const log = pino({
  level: LOG_LEVEL,
  transport: NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
}).child({ module: 'bot' });
