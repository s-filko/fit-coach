/**
 * The coach-quality judge's pure core (coach-quality-proof T3 / AC-CQ-3):
 * the L3 transcript parser, the judge-verdict parser (JSON-only, tolerating a
 * fenced block), and the T2 weight-hit computation against
 * nLoadExpectations(). No model, no DB — the CLI and its JUDGE_CMD spawn are
 * exercised by the script's own --dry-run.
 */
import type { NLoadExpectation } from '../../scenarios/n-load-shared';
import {
  parseJudgeVerdict,
  parseTranscriptMarkdown,
  summarizeVerdicts,
  weightHit,
  type JudgeVerdict,
  type WeightExtraction,
} from '../coach-quality-judge';

/** One transcript in the format reporter.formatScenarioTranscript writes (coach-quality T3 adds `run:`). */
const TRANSCRIPT = [
  '## n-load-up',
  '',
  '#0 user: привет, хочу потренироваться',
  'coach: Привет, Алекс! Отлично, давай подберём тренировку.',
  'tools: request_transition',
  'run: 11111111-1111-1111-1111-111111111111',
  'phase: session_planning',
  '  ✓ tools.must:request_transition',
  '',
  '#1 (advance)',
  'phase: session_planning',
  '',
  '#3 user: какой вес взять на жим?',
  'coach: Бери 82.5 кг: две тренировки подряд',
  '       все подходы по 10 с запасом.',
  'tools: (none)',
  'run: 22222222-2222-2222-2222-222222222222',
  'phase: training',
  '',
  'passed 3 / failed 0 / known-bug 0',
].join('\n');

describe('parseTranscriptMarkdown', () => {
  it('reads the scenario id and every user step: text, delivered, tools, run id, phase', () => {
    const parsed = parseTranscriptMarkdown(TRANSCRIPT);
    expect(parsed.scenarioId).toBe('n-load-up');
    expect(parsed.steps).toHaveLength(2);

    const [greeting, ask] = parsed.steps;
    expect(greeting).toEqual({
      stepIndex: 0,
      userText: 'привет, хочу потренироваться',
      delivered: 'Привет, Алекс! Отлично, давай подберём тренировку.',
      tools: ['request_transition'],
      runId: '11111111-1111-1111-1111-111111111111',
      phase: 'session_planning',
    });
    // Multi-line delivered text is re-joined; "(none)" tools is an empty list.
    expect(ask?.delivered).toBe('Бери 82.5 кг: две тренировки подряд\nвсе подходы по 10 с запасом.');
    expect(ask?.tools).toEqual([]);
    expect(ask?.runId).toBe('22222222-2222-2222-2222-222222222222');
    expect(ask?.phase).toBe('training');
  });

  it('never returns advance steps', () => {
    expect(parseTranscriptMarkdown(TRANSCRIPT).steps.every(s => s.userText !== '')).toBe(true);
    expect(parseTranscriptMarkdown(TRANSCRIPT).steps.map(s => s.stepIndex)).toEqual([0, 3]);
  });
});

describe('parseJudgeVerdict', () => {
  const VALID: JudgeVerdict = {
    friendly: 2,
    honest: 0,
    honestySpan: 'Записал: жим 60 кг × 10',
    coachingLogic: 1,
    brevity: 1,
    extraction: { exercise: 'Barbell Bench Press', proposedKg: 82.5, asked: false },
    note: 'claims a log with no tool call',
  };
  const VALID_JSON = JSON.stringify(VALID);

  it('parses a bare JSON object and normalizes a numeric-string proposedKg', () => {
    const verdict = parseJudgeVerdict(
      VALID_JSON.replace('"proposedKg":82.5', '"proposedKg":"82.5"').replace('"friendly":2', '"friendly":"2"'),
    );
    expect(verdict).toEqual(VALID);
  });

  it('parses a fenced ```json block (models wrap despite the instruction)', () => {
    expect(parseJudgeVerdict(`prefix noise\n\`\`\`json\n${VALID_JSON}\n\`\`\`\nsuffix`)).toEqual(VALID);
  });

  it('rejects out-of-range scores, missing keys, and non-JSON text (null → the caller retries once)', () => {
    expect(parseJudgeVerdict(VALID_JSON.replace('"friendly":2', '"friendly":3'))).toBeNull();
    expect(parseJudgeVerdict(VALID_JSON.replace('"honest":0', '"honest":2'))).toBeNull();
    expect(parseJudgeVerdict('{"friendly":2}')).toBeNull();
    expect(parseJudgeVerdict('I think the reply was fine.')).toBeNull();
  });
});

describe('weightHit — the T2 computation', () => {
  const expectation = (over: Partial<NLoadExpectation>): NLoadExpectation => ({
    scenarioId: 'n-load-up',
    exercise: 'Barbell Bench Press',
    direction: 'up',
    expectedKg: 82.5,
    acceptableKg: [82.5],
    reason: '2-for-2 (BR-TRAINING-042)',
    ...over,
  });
  const extraction = (over: Partial<WeightExtraction> = {}): WeightExtraction => ({
    exercise: 'Barbell Bench Press',
    proposedKg: 82.5,
    asked: false,
    ...over,
  });

  it('a proposed load inside acceptableKg is a hit', () => {
    const result = weightHit(extraction(), expectation({ acceptableKg: [80, 82.5] }));
    expect(result.hit).toBe(true);
    expect(result.detail).toContain('82.5');
  });

  it('the break case accepts the ~10 % alternative (acceptable [90, 97.5])', () => {
    expect(
      weightHit(extraction({ proposedKg: 90 }), expectation({ direction: 'down', expectedKg: 97.5, acceptableKg: [90, 97.5] })).hit,
    ).toBe(true);
    expect(
      weightHit(extraction({ proposedKg: 95 }), expectation({ direction: 'down', expectedKg: 97.5, acceptableKg: [90, 97.5] })).hit,
    ).toBe(false);
  });

  it('a load outside acceptableKg is a miss with the expected range in the detail', () => {
    const result = weightHit(extraction({ proposedKg: 85 }), expectation({}));
    expect(result.hit).toBe(false);
    expect(result.detail).toContain('82.5');
  });

  it('asking when a load was expected is a miss; proposing when ask was expected invents a number', () => {
    const askedInstead = weightHit(extraction({ proposedKg: null, asked: true }), expectation({}));
    expect(askedInstead.hit).toBe(false);
    expect(askedInstead.detail).toContain('ask');

    const invented = weightHit(
      extraction({ proposedKg: 60 }),
      expectation({ direction: 'ask', expectedKg: null, acceptableKg: [] }),
    );
    expect(invented.hit).toBe(false);

    const asked = weightHit(
      extraction({ proposedKg: null, asked: true }),
      expectation({ direction: 'ask', expectedKg: null, acceptableKg: [] }),
    );
    expect(asked.hit).toBe(true);
  });

  it('an extraction for another exercise does not score', () => {
    expect(weightHit(extraction({ exercise: 'Barbell Back Squat' }), expectation({})).hit).toBe(false);
  });
});

describe('summarizeVerdicts', () => {
  const verdict = (over: Partial<JudgeVerdict>): JudgeVerdict => ({
    friendly: 2,
    honest: 1,
    honestySpan: null,
    coachingLogic: 2,
    brevity: 1,
    extraction: { exercise: null, proposedKg: null, asked: false },
    note: '',
    ...over,
  });

  it('means, rates and every honesty failure with its span', () => {
    const summary = summarizeVerdicts([
      { scenarioId: 'a', stepIndex: 0, verdict: verdict({}) },
      {
        scenarioId: 'b',
        stepIndex: 1,
        verdict: verdict({ friendly: 1, honest: 0, honestySpan: 'в прошлый раз 10×80', coachingLogic: 0, brevity: 0 }),
      },
    ]);
    expect(summary.replies).toBe(2);
    expect(summary.friendlyMean).toBe(1.5);
    expect(summary.honestRate).toBe(0.5);
    expect(summary.coachingLogicMean).toBe(1);
    expect(summary.brevityRate).toBe(0.5);
    expect(summary.honestyFailures).toEqual([
      { scenarioId: 'b', stepIndex: 1, span: 'в прошлый раз 10×80', note: '' },
    ]);
  });
});
