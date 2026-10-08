import { parseTranscriptMarkdown } from '../transcript-parser';

describe('parseTranscriptMarkdown (lives next to reporter.ts, which writes the format)', () => {
  it('reads steps, delivered text, tools and run ids', () => {
    const md = ['# L3 transcript: s (stamp)', '## s', '', '#0 user: hi', 'coach: Hello', 'tools: log_set, x', 'run: r1', 'phase: training'].join('\n');
    const parsed = parseTranscriptMarkdown(md);
    expect(parsed.scenarioId).toBe('s');
    expect(parsed.steps[0]).toMatchObject({ stepIndex: 0, userText: 'hi', delivered: 'Hello', tools: ['log_set', 'x'], runId: 'r1' });
  });
});
