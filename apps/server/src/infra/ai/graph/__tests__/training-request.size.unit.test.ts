/**
 * Size pin for the assembled training request (coach-simplification I1, AC-CS1-5, P6): the exact request the
 * training phase sends for an invented realistic workout (6 planned exercises incl. a hold and a cardio warm-up, one
 * off-plan exercise, three earlier performances each, ~15 messages) stays inside the budget. Catches growth.
 */
import { assembleTrainingRequest, CASE07_FIXTURE, PLAIN_FIXTURE } from './training-request-fixture';

describe('training request size (AC-CS1-5)', () => {
  it('plain fixture: coach section <= 3 050, system <= 3 500, context <= 6 000, total text <= 12 000 chars', async () => {
    const req = await assembleTrainingRequest(PLAIN_FIXTURE());
    const chars = (name: string): number => req.sections.find(s => s.name === name)?.chars ?? NaN;

    expect(req.coachChars).toBeLessThanOrEqual(3050);
    expect(chars('system: coach prompt') + chars('system: # Profile')).toBeLessThanOrEqual(3500);
    expect(chars('context: # Today') + chars('context: # History') + chars('context: NOW line')).toBeLessThanOrEqual(
      6000,
    );
    expect(req.totalChars).toBeLessThanOrEqual(12000);
    expect(req.totalTokens).toBeLessThanOrEqual(3500);
  });

  it('case-07 shape stays far under the old ~58 000 characters', async () => {
    const req = await assembleTrainingRequest(CASE07_FIXTURE());
    expect(req.totalChars).toBeLessThanOrEqual(12000);
  });
});
