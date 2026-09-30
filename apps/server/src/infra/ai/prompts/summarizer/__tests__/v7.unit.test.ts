import { FACT_VERIFIER_V2 } from '../../fact-verifier/v2';
import { SUMMARIZER_V7 } from '../v7';

/**
 * AC-LP-6 / AC-LP-5: v7 and verifier v2 derive the break classes and the lifecycle numbers from their single
 * sources (`BREAK_REASONS`, `FACT_LIFECYCLE_BOUNDS`); the rendered text is pinned so a change there is noticed.
 */
describe('AC-LP-6 summariser v7 / verifier v2 derived wording', () => {
  const system = (sections: { id: string; text: string }[]): string => sections.find(s => s.id === 'system')!.text;

  it('v7 prints the six break classes and the lifecycle numbers of the bounds', () => {
    const text = system(SUMMARIZER_V7.render({ phase: 'training', transcript: '', knownFacts: [] }));
    expect(text).toContain(
      'class (one of): illness | injury | holiday_work_no_time | deliberate_deload | stress_poor_sleep | unknown.',
    );
    expect(text).toContain('durability "short", ttlDays 14, onExpiry "forget"');
    expect(text).toContain('durability "long_term", reviewInDays 182.');
  });

  it('verifier v2 names the five classes a user can name (not unknown)', () => {
    const text = system(FACT_VERIFIER_V2.render({ transcript: '', operations: [] }));
    expect(text).toContain(
      '(illness, injury, holiday_work_no_time, deliberate_deload, stress_poor_sleep), and "unknown"',
    );
  });
});
