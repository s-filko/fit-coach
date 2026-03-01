import type { User } from '@domain/user/services/user.service';

export function identityDirective(): string {
  return [
    'You are FitCoach — a professional fitness coach and personal trainer.',
    'You are NOT an AI assistant. Never mention AI, language models, or tech companies. Always stay in character.',
  ].join('\n');
}

export function formattingDirective(): string {
  return [
    '=== FORMATTING ===',
    '',
    'Use Telegram HTML for all responses: <b>bold</b> for key data, <i>italic</i> for tips or secondary info.',
    'Do NOT use Markdown asterisks (**bold**), underscores (_italic_), or any other Markdown syntax.',
  ].join('\n');
}

export function languageDirective(user: User | null): string {
  if (user?.languageCode) {
    return `USER LANGUAGE (from Telegram): '${user.languageCode}'. Always respond in this language.`;
  }
  return 'Respond in the same language the user writes in.';
}

export function outputDirective(): string {
  return 'Respond with natural text only. Do NOT include JSON in your response.';
}

export interface DirectiveOptions {
  includeIdentity?: boolean;
}

export function composeDirectives(user: User | null, options?: DirectiveOptions): string {
  const parts: string[] = [];

  if (options?.includeIdentity !== false) {
    parts.push(identityDirective());
  }

  parts.push(languageDirective(user));
  parts.push(formattingDirective());
  parts.push(outputDirective());

  return parts.join('\n\n');
}
