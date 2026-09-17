// Mock-prefixed on purpose: the jest.mock factory below reads them at call time.
const mockRunRows = [
  {
    runId: 'r1',
    userId: 'u1',
    phaseIn: 'chat',
    model: 'z-ai/glm-5.3',
    createdAt: new Date('2026-09-01T10:00:05Z'),
    latencyMs: 5000,
  },
];
const linkedTurnRows = [
  {
    userId: 'u1',
    runId: 'r1',
    role: 'user',
    kind: 'human',
    content: 'привет',
    createdAt: new Date('2026-09-01T10:00:00Z'),
  },
  {
    userId: 'u1',
    runId: 'r1',
    role: 'assistant',
    kind: 'ai',
    content: 'здравствуй',
    createdAt: new Date('2026-09-01T10:00:04Z'),
  },
];
// BUG-016 shape: production appendTurn writes turns without run_id.
// The fallback path must still attach them via the run's time window.
const unlinkedTurnRows = [
  {
    userId: 'u1',
    runId: null,
    role: 'user',
    kind: 'human',
    content: 'привет',
    createdAt: new Date('2026-09-01T10:00:01Z'),
  },
  {
    userId: 'u1',
    runId: null,
    role: 'assistant',
    kind: 'ai',
    content: 'здравствуй',
    createdAt: new Date('2026-09-01T10:00:04Z'),
  },
];
let mockTurnsRows: Array<{
  userId: string;
  runId: string | null;
  role: string;
  kind: string;
  content: string;
  createdAt: Date;
}> = linkedTurnRows;

jest.mock('@infra/db/drizzle', () => {
  const rowsFor = (table: unknown) =>
    table === jest.requireActual('@infra/db/schema').conversationRuns ? mockRunRows : mockTurnsRows;
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => rowsFor(table),
              // the fallback query awaits orderBy() directly, without .limit()
              then: (resolve: (rows: unknown) => void) => resolve(rowsFor(table)),
            }),
          }),
        }),
      }),
    },
  };
});

import { fetchRunsSince } from '../export-query';

describe('fetchRunsSince', () => {
  it('groups turns under their run via explicit run_id', async () => {
    mockTurnsRows = linkedTurnRows;
    const runs = await fetchRunsSince(new Date('2026-08-01'), 100);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.turns).toHaveLength(2);
    expect(runs[0]?.phase).toBe('chat');
  });

  it('falls back to the user turns inside the run time window when run_id is missing', async () => {
    mockTurnsRows = unlinkedTurnRows;
    const runs = await fetchRunsSince(new Date('2026-08-01'), 100);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.turns).toHaveLength(2);
    expect(runs[0]?.turns[0]?.content).toBeDefined();
    expect(runs[0]?.turns[1]?.createdAt).toEqual(new Date('2026-09-01T10:00:04Z'));
  });
});
