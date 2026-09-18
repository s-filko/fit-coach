import { toSummaryInsert, toSummaryTurnRow } from '../drizzle-summary.service';

const INPUT = {
  userId: 'u-1',
  runId: 'run-1',
  episodeId: 'ep-1',
  phaseAtEnd: 'training' as const,
  structured: { topics: ['legs'], decisions: [], userState: [], trainingFeedback: [], openItems: [] },
  rendered: '## Previous episodes\n- training (today): topics: legs',
};

describe('drizzle-summary row mapping (D-K, D-G)', () => {
  it('maps an insert to the conversation_summaries row shape', () => {
    const row = toSummaryInsert(INPUT);
    expect(row).toMatchObject({
      userId: 'u-1',
      runId: 'run-1',
      episodeId: 'ep-1',
      phaseAtEnd: 'training',
      structured: INPUT.structured,
      rendered: INPUT.rendered,
    });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('mirrors the summary into a kind=summary role=summary turn row (a P3 rollback reads the latest one)', () => {
    const row = toSummaryTurnRow(INPUT);
    expect(row).toMatchObject({
      userId: 'u-1',
      phase: 'training',
      runId: 'run-1',
      kind: 'summary',
      role: 'summary',
      content: INPUT.rendered,
      payload: INPUT.structured,
    });
  });
});
