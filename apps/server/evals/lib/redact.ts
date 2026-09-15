import { createHash } from 'node:crypto';

/**
 * Redaction for exported transcripts — BR-EVAL-003 and LOGGING_GUIDE
 * "Forbidden data categories". Pseudonyms are stable within and across exports
 * so multi-turn structure survives, and irreversible without the original id.
 */
export function pseudonymise(userId: string): string {
  return `user-${createHash('sha256').update(userId).digest('hex').slice(0, 6)}`;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
// Scrubbed before PHONE so a UUID is not half-eaten by the phone pattern first.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const PHONE = /\+?\d[\d\s()-]{8,}\d/g;

export function redactText(text: string, firstName: string | null): string {
  let out = text.replace(EMAIL, '[EMAIL]').replace(UUID, '[ID]').replace(PHONE, '[PHONE]');
  if (firstName && firstName.length >= 2) {
    const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), '[NAME]');
  }
  return out;
}

export interface RedactedUser {
  languageCode: string;
  timezone: string;
  age?: number;
  gender?: string;
  height?: string;
  weight?: string;
  fitnessLevel?: string;
  fitnessGoal?: string;
}

/** Allowlist, not a denylist: a new PII column must not leak by default. */
const FIXTURE_FIELDS = [
  'languageCode',
  'timezone',
  'age',
  'gender',
  'height',
  'weight',
  'fitnessLevel',
  'fitnessGoal',
] as const;

export function redactUser(user: Record<string, unknown>): RedactedUser {
  const out: Record<string, unknown> = {};
  for (const field of FIXTURE_FIELDS) {
    if (user[field] !== undefined && user[field] !== null) {
      out[field] = user[field];
    }
  }
  return out as unknown as RedactedUser;
}
