import type { DirectiveModule } from '@infra/ai/prompts/types';

export const TIME_REFERENCE_V1: DirectiveModule = {
  id: 'time-reference',
  version: 'v1',
  render: () => ({
    id: 'directive.time-reference',
    required: true,
    text: [
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
    ].join('\n'),
  }),
};
