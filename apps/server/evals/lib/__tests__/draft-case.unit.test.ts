import { buildDraftCase } from '../draft-case';
import type { ExportedRun } from '../export-query';

const RUN_UUID = '3f2a1b8c-9d4e-4f5a-8b6c-1d2e3f4a5b6c';
const RAW_USER_ID = '11111111-2222-4333-8444-555555555555';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const run: ExportedRun = {
  runId: RUN_UUID,
  userId: RAW_USER_ID,
  phase: 'chat',
  createdAt: new Date('2026-09-14T10:00:00Z'),
  model: 'glm-5.3',
  turns: [
    { role: 'user', kind: 'human', content: 'привет, Иван', createdAt: new Date('2026-09-14T09:59:58Z') },
    { role: 'assistant', kind: 'ai', content: `сессия ${RUN_UUID} открыта`, createdAt: new Date('2026-09-14T09:59:59Z') },
    { role: 'user', kind: 'human', content: 'жим 80 на 8', createdAt: new Date('2026-09-14T10:00:00Z') },
  ],
};

const user = { id: RAW_USER_ID, firstName: 'Иван', languageCode: 'ru', timezone: 'Europe/Berlin' };

describe('buildDraftCase', () => {
  it('leaks no raw UUID or user id anywhere in the record', () => {
    const record = buildDraftCase(run, user);
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(RUN_UUID);
    expect(serialized).not.toContain(RAW_USER_ID);
    expect(serialized).not.toMatch(UUID_RE);
    expect((record as Record<string, unknown>)['provenance']).not.toHaveProperty('runId');
  });

  it('takes the last human turn as input and everything before it as state', () => {
    const record = buildDraftCase(run, user) as {
      input: { text: string };
      state: { messages: Array<{ role: string; text: string }> };
    };
    expect(record.input.text).toBe('жим 80 на 8');
    expect(record.state.messages).toHaveLength(2);
    expect(record.state.messages[0]?.text).toBe('привет, [NAME]');
    expect(record.state.messages[1]?.text).toContain('[ID]');
  });

  it('returns null when the run has no human turn', () => {
    const aiOnly: ExportedRun = {
      ...run,
      turns: [run.turns[1] ?? { role: 'assistant', kind: 'ai', content: 'x', createdAt: new Date() }],
    };
    expect(buildDraftCase(aiOnly, user)).toBeNull();
  });
});
