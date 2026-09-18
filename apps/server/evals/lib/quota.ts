import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface QuotaSnapshot {
  fiveHourRemaining: number;
  weeklyRemaining: number;
  unit: string;
}

/**
 * Z.AI monitor API (D-R, corrected 2026-09-18 by the owner's pointer):
 * `GET https://api.z.ai/api/monitor/usage/quota/limit` with
 * `Authorization: <subscription token>` (raw, no Bearer). Discovered via the
 * glm-plan-usage / zai-usage-tracker community tooling; the response is
 * `data.limits[]` where `type: 'CREDIT_LIMIT'`, `unit: 3` is the 5-hour
 * window and `unit: 6` the weekly one (`usage` = limit, `currentValue` =
 * used, `remaining` in credits).
 *
 * Which token: the **subscription token that powers Claude Code**
 * (`ANTHROPIC_AUTH_TOKEN` in ~/.claude/settings.json). The app's
 * `LLM_API_KEY` (the OpenAI-compatible coding-gateway key) is rejected by
 * the monitor with 401 — two keys of one subscription, different scopes.
 * Resolution order: `ZAI_QUOTA_TOKEN` env → `ANTHROPIC_AUTH_TOKEN` env →
 * ~/.claude/settings.json. The token is never printed.
 *
 * `TOKENS_LIMIT` entries (token-quota plans) carry `percentage` only — if
 * that is all a plan exposes, this returns null and the manual
 * `--quota-before` flag takes over (same D-R fallback as before).
 */

interface LimitEntry {
  type?: string;
  unit?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  percentage?: number;
}

function quotaToken(): string | null {
  const fromEnv = process.env['ZAI_QUOTA_TOKEN'] ?? process.env['ANTHROPIC_AUTH_TOKEN'] ?? '';
  if (fromEnv !== '') {
    return fromEnv;
  }
  try {
    const settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8')) as {
      env?: Record<string, string>;
    };
    return settings.env?.ANTHROPIC_AUTH_TOKEN ?? null;
  } catch {
    return null;
  }
}

/** Injected for tests; the real fetch has a 5-second timeout. */
async function fetchJson(url: string, token: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: token, 'Accept-Language': 'en-US,en' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function readQuota(
  fetcher: (url: string, token: string) => Promise<unknown> = fetchJson,
  token: string | null = quotaToken(),
): Promise<QuotaSnapshot | null> {
  if (token === null || token === '') {
    return null;
  }
  const body = (await fetcher('https://api.z.ai/api/monitor/usage/quota/limit', token)) as {
    data?: { limits?: LimitEntry[] };
    limits?: LimitEntry[];
  } | null;
  if (body === null) {
    return null;
  }
  const limits = body.data?.limits ?? body.limits ?? [];
  const fiveHour = limits.find(l => l.type === 'CREDIT_LIMIT' && l.unit === 3);
  const weekly = limits.find(l => l.type === 'CREDIT_LIMIT' && l.unit === 6);
  if (fiveHour === undefined || weekly === undefined) {
    return null;
  }
  return {
    fiveHourRemaining: fiveHour.remaining ?? 0,
    weeklyRemaining: weekly.remaining ?? 0,
    unit: 'credits',
  };
}
