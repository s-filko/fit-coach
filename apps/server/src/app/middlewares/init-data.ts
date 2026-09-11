import { createHmac, timingSafeEqual } from 'node:crypto';

import { FastifyReply, FastifyRequest } from 'fastify';

import { loadConfig } from '@config/index';

const INIT_DATA_HEADER = 'x-init-data' as const;
const MAX_AUTH_AGE_SECONDS = 86400;
const SECONDS_DIVISOR = 1000;
const HTTP_UNAUTHORIZED = 401;
const INVALID: InitDataValidationResult = { valid: false };

let hmacSkipLogged = false;

function extractInitData(request: FastifyRequest): string {
  const raw = request.headers[INIT_DATA_HEADER];
  return typeof raw === 'string' ? raw.trim() : '';
}

interface TelegramUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface InitDataValidationResult {
  valid: boolean;
  telegramUserId?: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
}

export function verifyHmac(params: URLSearchParams, hash: string, botToken: string): boolean {
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computed.length !== hash.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

export function isAuthDateExpired(params: URLSearchParams): boolean {
  const authDate = params.get('auth_date');
  if (!authDate) {
    return false;
  }
  const age = Math.floor(Date.now() / SECONDS_DIVISOR) - Number(authDate);
  return age > MAX_AUTH_AGE_SECONDS;
}

export function parseUser(params: URLSearchParams): InitDataValidationResult {
  const userStr = params.get('user');
  if (!userStr) {
    return INVALID;
  }
  try {
    const user = JSON.parse(userStr) as TelegramUser;
    if (typeof user.id !== 'number') {
      return INVALID;
    }
    return {
      valid: true,
      telegramUserId: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      languageCode: user.language_code,
    };
  } catch {
    return INVALID;
  }
}

export function validateInitData(raw: string, botToken: string): InitDataValidationResult {
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) {
    return INVALID;
  }

  params.delete('hash');

  if (!verifyHmac(params, hash, botToken)) {
    return INVALID;
  }

  if (isAuthDateExpired(params)) {
    return INVALID;
  }

  return parseUser(params);
}

function parseInitDataDev(raw: string): InitDataValidationResult {
  const params = new URLSearchParams(raw);
  return parseUser(params);
}

function isLocalRequest(req: FastifyRequest): boolean {
  const host = req.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.startsWith('localhost:');
}

function resolveInitData(raw: string, req: FastifyRequest): InitDataValidationResult {
  const config = loadConfig();

  if (config.NODE_ENV === 'development' && isLocalRequest(req)) {
    if (!hmacSkipLogged) {
      req.log.warn('HMAC validation skipped for localhost request');
      hmacSkipLogged = true;
    }
    return parseInitDataDev(raw);
  }

  return validateInitData(raw, config.TELEGRAM_TOKEN);
}

export async function initDataPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = extractInitData(req);

  if (!raw) {
    req.log.warn({ path: req.url }, 'Missing X-Init-Data');
    await reply.code(HTTP_UNAUTHORIZED).send({ error: { message: 'Missing X-Init-Data' } });
    return;
  }

  const result = resolveInitData(raw, req);

  if (!result.valid || !result.telegramUserId) {
    req.log.warn({ path: req.url }, 'Invalid X-Init-Data');
    await reply.code(HTTP_UNAUTHORIZED).send({ error: { message: 'Invalid X-Init-Data' } });
    return;
  }

  const providerUserId = String(result.telegramUserId);
  const user = await req.server.services.userService.upsertUser({
    provider: 'telegram',
    providerUserId,
    username: result.username,
    firstName: result.firstName,
    lastName: result.lastName,
    languageCode: result.languageCode,
  });

  req.telegramUserId = user.id;
}
