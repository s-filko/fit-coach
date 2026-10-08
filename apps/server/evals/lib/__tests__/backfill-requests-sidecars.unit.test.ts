import { runIdsOfTranscript, sidecarIsCurrent } from '../backfill-requests-sidecars';

const MD = [
  '## n-load-up',
  '',
  '#0 user: привет',
  'coach: Привет',
  'tools: (none)',
  'run: 11111111-1111-1111-1111-111111111111',
  '',
  '#1 user: вес на жим?',
  'coach: 82.5',
  'tools: (none)',
  'run: 11111111-1111-1111-1111-111111111111',
  '',
  '#2 user: ещё',
  'coach: ок',
  'tools: (none)',
  'run: 22222222-2222-2222-2222-222222222222',
].join('\n');

describe('backfill helpers', () => {
  it('lists the distinct run ids of a transcript in order', () => {
    expect(runIdsOfTranscript(MD)).toEqual(['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']);
  });

  it('a transcript without run lines has no ids', () => {
    expect(runIdsOfTranscript('## x\n\n#0 user: a\ncoach: b\n')).toEqual([]);
  });

  it('a sidecar is current only when every entry carries a system message', () => {
    expect(sidecarIsCurrent(JSON.stringify({ a: { requestContext: 'c', coachSystem: 'S' } }))).toBe(true);
    expect(sidecarIsCurrent(JSON.stringify({ a: { requestContext: 'c' } }))).toBe(false);
    expect(sidecarIsCurrent(JSON.stringify({ a: { error: 'x' } }))).toBe(false);
    expect(sidecarIsCurrent('{not json')).toBe(false);
  });
});
