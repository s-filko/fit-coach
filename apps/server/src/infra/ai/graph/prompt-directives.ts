import type { User } from '@domain/user/services/user.service';
import { calendarDaysAgo } from '@shared/date-utils';

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

export function nameUsageDirective(): string {
  return "Use the client's name SPARINGLY — only on first greeting and in summary/recap messages. Do NOT repeat the name in every response.";
}

export function outputDirective(): string {
  return 'Respond with natural text only. Do NOT include JSON in your response.';
}

export function timezoneDirective(user: User | null): string {
  if (user?.timezone) {
    return `USER TIMEZONE: '${user.timezone}'. Use it for all date/time references.`;
  }
  return [
    'USER TIMEZONE: unknown.',
    'If the conversation involves scheduling, workout timing, or time-of-day context,',
    'ask the user for their city or timezone, then call save_timezone tool before continuing.',
    'Do not ask about timezone if it is not relevant to the current message.',
  ].join(' ');
}

export function workoutTimeReferenceDirective(): string {
  return [
    '=== HOW TO REFERENCE PAST WORKOUTS ===',
    '',
    'Session timestamps in the data already include human-friendly labels:',
    '  "yesterday (Tue) evening", "2d ago (Mon) morning", "5d ago (Fri)", "12d ago".',
    'Use these labels to speak naturally about past workouts. Examples:',
    '',
    'Label "yesterday (Tue) evening" → "вчера вечером ты тренировал грудь"',
    'Label "2d ago (Mon) morning"    → "в понедельник утром у тебя была тренировка ног"',
    'Label "5d ago (Fri)"            → "в пятницу ты делал становую"',
    'Label "12d ago"                 → "12 дней назад ты делал присед"',
    '',
    'NEVER use raw ISO dates, "2026-04-07", or technical labels like "2d ago (Mon) morning"',
    'in user-facing text. Always rephrase into natural language.',
  ].join('\n');
}

export function toolReplyDirective(): string {
  return [
    'TOOL CALL RULE: Every response that contains a tool call MUST also contain visible text for the user.',
    'The text MUST appear in the same response as the tool call — never send a tool call alone.',
    '',
    'CORRECT (tool call + text together):',
    '  text: "Moving you to the session planner now."',
    '  tool_call: request_transition({ toPhase: "session_planning" })',
    '',
    'WRONG (tool call without text — this will break the app):',
    '  tool_call: request_transition({ toPhase: "session_planning" })',
    '  text: ""  ← empty, user sees nothing',
  ].join('\n');
}

/**
 * Determines if the user should be greeted.
 * Returns a directive string if this is the first message of a new calendar day
 * (in the user's timezone) and at least 4 hours have passed since the last message.
 */
export function greetingDirective(user: User | null, lastMessageTime: Date | null): string | null {
  if (!lastMessageTime) return null;

  const now = new Date();
  const tz = user?.timezone;
  const daysSinceLastMsg = calendarDaysAgo(lastMessageTime, now, tz);
  if (daysSinceLastMsg < 1) return null;

  const hoursSince = (now.getTime() - lastMessageTime.getTime()) / (1000 * 60 * 60);
  if (hoursSince < 4) return null;

  return [
    "GREETING: This is the user's first message today (new day since last activity).",
    'Start your response with a brief, warm greeting appropriate to the time of day',
    '(e.g. "Доброе утро!", "Привет!", "Добрый вечер!").',
    "Then address the user's message as usual.",
  ].join(' ');
}

export interface DirectiveOptions {
  includeIdentity?: boolean;
  lastMessageTime?: Date | null;
}

export function composeDirectives(user: User | null, options?: DirectiveOptions): string {
  const parts: string[] = [];

  if (options?.includeIdentity !== false) {
    parts.push(identityDirective());
  }

  const greeting = greetingDirective(user, options?.lastMessageTime ?? null);
  if (greeting) {
    parts.push(greeting);
  }

  parts.push(languageDirective(user));
  parts.push(timezoneDirective(user));
  parts.push(nameUsageDirective());
  parts.push(formattingDirective());
  parts.push(workoutTimeReferenceDirective());
  parts.push(outputDirective());
  parts.push(toolReplyDirective());

  return parts.join('\n\n');
}
