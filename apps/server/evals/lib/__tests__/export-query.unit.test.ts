const runRows = [
  {
    runId: 'r1',
    userId: 'u1',
    phaseIn: 'chat',
    model: 'z-ai/glm-5.3',
    createdAt: new Date('2026-09-01T10:00:00Z'),
  },
];
const turnRows = [
  { userId: 'u1', runId: 'r1', role: 'user', kind: 'human', content: 'привет', createdAt: new Date('2026-09-01T10:00:00Z') },
  { userId: 'u1', runId: 'r1', role: 'assistant', kind: 'ai', content: 'здравствуй', createdAt: new Date('2026-09-01T10:00:05Z') },
];

jest.mock('@infra/db/drizzle', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => (table === jest.requireActual('@infra/db/schema').conversationRuns ? runRows : turnRows),
          }),
        }),
      }),
    }),
  },
}));

import { fetchRunsSince } from '../export-query';

describe('fetchRunsSince', () => {
  it('groups turns under their run', async () => {
    const runs = await fetchRunsSince(new Date('2026-08-01'), 100);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.turns).toHaveLength(2);
    expect(runs[0]?.phase).toBe('chat');
  });
});
