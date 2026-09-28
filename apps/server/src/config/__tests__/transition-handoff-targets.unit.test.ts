import { EnvSchema } from '../index';
import { parseTransitionHandoffTargets } from '../transition-handoff-targets';
import { BASE_ENV } from './base-env.fixture';

const BASE = BASE_ENV;

describe('parseTransitionHandoffTargets (transition-handoff plan Task 1, D-1)', () => {
  it('returns an empty array when unset or blank', () => {
    expect(parseTransitionHandoffTargets(undefined)).toEqual([]);
    expect(parseTransitionHandoffTargets('')).toEqual([]);
    expect(parseTransitionHandoffTargets('   ')).toEqual([]);
  });

  it('parses a single phase', () => {
    expect(parseTransitionHandoffTargets('training')).toEqual(['training']);
  });

  it('parses a comma list, trimming whitespace and dropping empty entries', () => {
    expect(parseTransitionHandoffTargets('training, session_planning ,')).toEqual(['training', 'session_planning']);
  });

  it('rejects an unknown phase with a clear message', () => {
    expect(() => parseTransitionHandoffTargets('training,not_a_phase')).toThrow(
      /TRANSITION_HANDOFF_TARGETS.*not_a_phase/,
    );
  });
});

describe('TRANSITION_HANDOFF_TARGETS (EnvSchema integration)', () => {
  it('defaults to an empty array (flag off — today’s behaviour)', () => {
    expect(EnvSchema.parse(BASE).TRANSITION_HANDOFF_TARGETS).toEqual([]);
  });

  it('parses a configured value into ConversationPhase[]', () => {
    const env = EnvSchema.parse({ ...BASE, TRANSITION_HANDOFF_TARGETS: 'training,session_planning' });
    expect(env.TRANSITION_HANDOFF_TARGETS).toEqual(['training', 'session_planning']);
  });

  it('fails fast on an unknown phase', () => {
    expect(() => EnvSchema.parse({ ...BASE, TRANSITION_HANDOFF_TARGETS: 'training,bogus' })).toThrow(
      /unknown phase "bogus"/,
    );
  });
});
