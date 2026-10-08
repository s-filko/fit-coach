/**
 * The coach-quality judge's pure core (coach-quality-proof T3 / AC-CQ-3):
 * the L3 transcript parser, the judge-verdict parser (JSON-only, tolerating a
 * fenced block), and the T2 weight-hit computation against
 * nLoadExpectations(). No model, no DB — the CLI and its JUDGE_CMD spawn are
 * exercised by the script's own --dry-run.
 */

import { pickCoachCall, pickCoachContext, resolveSystemText } from '../../lib/write-requests-sidecar';
import type { NLoadExpectation } from '../../scenarios/n-load-shared';
import {
  buildJudgePrompt,
  judgeReplyVia,
  parseJudgeVerdict,
  parseRequestsSidecar,
  parseTranscriptMarkdown,
  summarizeRun,
  summarizeVerdicts,
  weightHit,
  type Evidence,
  type JudgeSpawn,
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
    extraction: { exercise: 'Barbell Bench Press', proposedKg: 82.5, asked: false, reasonStated: false },
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
    reasonStated: false,
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
    extraction: { exercise: null, proposedKg: null, asked: false, reasonStated: false },
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

// --- one reply's judge failure never aborts the run (the 1301 hardening) ---

/** The observed failure: GLM's CLI refuses one reply ('API Error: [1301]…') and exits non-zero. */
const CLI_REFUSAL = 'API Error: [1301][System detected potentially unsafe or sensitive content]';
const VERDICT_JSON = JSON.stringify({
  friendly: 2,
  honest: 1,
  honestySpan: null,
  coachingLogic: 2,
  brevity: 1,
  extraction: { exercise: null, proposedKg: null, asked: false, reasonStated: false },
  note: 'ok',
} satisfies JudgeVerdict);

const EVIDENCE: Evidence = {
  scenarioId: 'n-load-up',
  stepIndex: 3,
  userText: 'какой вес взять на жим?',
  delivered: 'Бери 82.5 кг.',
  tools: [],
  requestContext: '(context)',
  coachSystem: '(system)',
  toolCallsWithArgs: '',
};

/** A spawn whose PRIMARY command refuses everything; the fallback answers a valid verdict. */
function refusingSpawn(calls: Array<{ cmd: string; prompt: string }>): JudgeSpawn {
  return (prompt, cmd) => {
    calls.push({ cmd, prompt });
    if (cmd === 'primary-cmd') {
      return { ok: false, error: CLI_REFUSAL };
    }
    return { ok: true, raw: VERDICT_JSON };
  };
}

describe('judgeReplyVia — a CLI failure or bad JSON on one reply never aborts the run', () => {
  it('a primary CLI failure without a fallback → unjudged, the CLI error in the reason', () => {
    const outcome = judgeReplyVia(EVIDENCE, '(rubric)', refusingSpawn([]), 'primary-cmd');
    expect(outcome).toEqual({ unjudged: true, reason: expect.stringContaining('[1301]') });
  });

  it('a primary CLI failure with a fallback → the fallback verdict, usedFallback true', () => {
    const calls: Array<{ cmd: string; prompt: string }> = [];
    const outcome = judgeReplyVia(EVIDENCE, '(rubric)', refusingSpawn(calls), 'primary-cmd', 'fallback-cmd');
    expect(outcome).toEqual({ verdict: expect.objectContaining({ friendly: 2 }), raw: VERDICT_JSON, usedFallback: true });
    // The refused primary is NOT retried — a content refusal is deterministic.
    expect(calls.filter(c => c.cmd === 'primary-cmd')).toHaveLength(1);
    expect(calls.filter(c => c.cmd === 'fallback-cmd')).toHaveLength(1);
  });

  it('bad JSON once, then good → the primary verdict, no fallback called', () => {
    const calls: Array<{ cmd: string; prompt: string }> = [];
    let attempt = 0;
    const spawn: JudgeSpawn = (_prompt, cmd) => {
      calls.push({ cmd, prompt: _prompt });
      return { ok: true, raw: attempt++ === 0 ? 'not json' : VERDICT_JSON };
    };
    const outcome = judgeReplyVia(EVIDENCE, '(rubric)', spawn, 'primary-cmd', 'fallback-cmd');
    expect(outcome).toEqual({ verdict: expect.objectContaining({ honest: 1 }), raw: VERDICT_JSON, usedFallback: false });
    expect(calls.every(c => c.cmd === 'primary-cmd')).toBe(true);
  });

  it('bad JSON twice with a fallback → the fallback verdict', () => {
    const spawn: JudgeSpawn = (_prompt, cmd) => ({ ok: true, raw: cmd === 'fallback-cmd' ? VERDICT_JSON : 'still not json' });
    const outcome = judgeReplyVia(EVIDENCE, '(rubric)', spawn, 'primary-cmd', 'fallback-cmd');
    expect(outcome).toEqual({ verdict: expect.anything(), raw: VERDICT_JSON, usedFallback: true });
  });

  it('bad JSON twice without a fallback → unjudged', () => {
    const spawn: JudgeSpawn = () => ({ ok: true, raw: 'nope' });
    expect(judgeReplyVia(EVIDENCE, '(rubric)', spawn, 'primary-cmd')).toEqual({
      unjudged: true,
      reason: expect.stringContaining('JSON'),
    });
  });

  it('a failing fallback → unjudged with the fallback error', () => {
    const spawn: JudgeSpawn = (_prompt, cmd) =>
      cmd === 'fallback-cmd' ? { ok: false, error: 'fallback exploded' } : { ok: true, raw: 'not json' };
    expect(judgeReplyVia(EVIDENCE, '(rubric)', spawn, 'primary-cmd', 'fallback-cmd')).toEqual({
      unjudged: true,
      reason: expect.stringContaining('fallback exploded'),
    });
  });
});

describe('summarizeRun — means exclude unjudged replies and say so', () => {
  const verdict = (over: Partial<JudgeVerdict>): JudgeVerdict => ({
    friendly: 2,
    honest: 1,
    honestySpan: null,
    coachingLogic: 2,
    brevity: 1,
    extraction: { exercise: null, proposedKg: null, asked: false, reasonStated: false },
    note: '',
    ...over,
  });

  it('counts judged/unjudged/fallback separately; the means cover the judged only', () => {
    const run = summarizeRun([
      { file: 'a.md', scenarioId: 'a', stepIndex: 0, outcome: { verdict: verdict({ friendly: 1 }), raw: VERDICT_JSON, usedFallback: false } },
      { file: 'a.md', scenarioId: 'a', stepIndex: 1, outcome: { verdict: verdict({}), raw: VERDICT_JSON, usedFallback: true } },
      { file: 'b.md', scenarioId: 'b', stepIndex: 0, outcome: { unjudged: true, reason: CLI_REFUSAL } },
    ], 4);
    expect(run.totalSteps).toBe(4);
    expect(run.judgedCount).toBe(2);
    expect(run.unjudged).toEqual([{ file: 'b.md', scenarioId: 'b', stepIndex: 0, reason: CLI_REFUSAL }]);
    expect(run.fallbackUsed).toBe(1);
    // The means come from the two judged replies only (friendly (1+2)/2 = 1.5).
    expect(run.means.friendlyMean).toBe(1.5);
    expect(run.means.replies).toBe(2);
    expect(run.exclusionNote).toContain('excluded');
  });
});

// --- the real L3 transcript files (candidate + baseline-dev kinds) ---

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The judge ran on the real transcripts and got empty evidence: the files open
 * with run.ts's `# L3 transcript: <id> (<stamp>)` header line, which pushed the
 * `## <scenarioId>` line off position 0. These fixtures are REAL files — one
 * per kind (candidate = this branch's reporter, baseline = dev + the run-id
 * reporter patch) — copied from the measurement runs of 2026-10-07/08.
 */
describe.each([
  ['candidate', join(__dirname, 'fixtures', 'candidate-b-full-workout.md')],
  ['baseline-dev', join(__dirname, 'fixtures', 'baseline-b-full-workout.md')],
])('parseTranscriptMarkdown — the real %s transcript file', (_kind, path) => {
  const parsed = parseTranscriptMarkdown(readFileSync(path, 'utf8'));

  it('reads the scenario id (behind the L3-transcript header line)', () => {
    expect(parsed.scenarioId).toBe('b-full-workout');
  });

  it('every step has non-empty user text, a coach reply and a run id', () => {
    expect(parsed.steps.length).toBeGreaterThanOrEqual(9);
    for (const step of parsed.steps) {
      expect(step.userText).not.toBe('');
      expect(step.delivered).not.toBe('');
      expect(step.runId).toMatch(/^[0-9a-f-]{8,}$/);
    }
  });

  it('the greeting step carries its delivered reply verbatim', () => {
    expect(parsed.steps[0]?.delivered).toContain('Привет');
  });
});

// --- the requests sidecar (written by the L3 runner next to each transcript) ---

describe('parseRequestsSidecar', () => {
  it('maps every run id to its context and tool calls; error and malformed entries are skipped', () => {
    const sidecar = parseRequestsSidecar(
      JSON.stringify({
        'run-1': { requestContext: '# Today …', toolCalls: [{ name: 'log_set', args: { reps: 10, weight: 82.5 } }] },
        'run-2': { error: 'llm_calls read failed' },
        'run-3': 'not an object',
      }),
    );
    expect(sidecar.get('run-1')).toEqual({
      requestContext: '# Today …',
      coachSystem: '',
      toolCallsWithArgs: `log_set ${JSON.stringify({ reps: 10, weight: 82.5 })}`,
    });
    expect(sidecar.has('run-2')).toBe(false);
    expect(sidecar.has('run-3')).toBe(false);
  });

  it('a malformed file is an empty map (the judge falls back to the DB)', () => {
    expect(parseRequestsSidecar('{not json')).toEqual(new Map());
  });
});

// --- the miss CHOICE (owner 2026-10-08): hold-with-reason needs reasonStated in the extraction ---

describe('parseJudgeVerdict — the reasonStated extraction field', () => {
  const base = {
    friendly: 2,
    honest: 1,
    honestySpan: null,
    coachingLogic: 2,
    brevity: 1,
    extraction: { exercise: null, proposedKg: null, asked: false, reasonStated: true },
    note: '',
  };

  it('reads reasonStated true', () => {
    expect(parseJudgeVerdict(JSON.stringify(base))!.extraction.reasonStated).toBe(true);
  });

  it('absent or non-boolean reads false (never blocks the verdict)', () => {
    const absent = { ...base, extraction: { exercise: null, proposedKg: 97.5, asked: false } };
    expect(parseJudgeVerdict(JSON.stringify(absent))!.extraction.reasonStated).toBe(false);
    const wrongType = { ...base, extraction: { ...base.extraction, reasonStated: 'yes' } };
    expect(parseJudgeVerdict(JSON.stringify(wrongType))!.extraction.reasonStated).toBe(false);
  });
});

describe('weightHit — the miss choice: step down OR hold with a stated reason', () => {
  const missExpectation: NLoadExpectation = {
    scenarioId: 'n-load-miss',
    exercise: 'Barbell Back Squat',
    direction: 'down',
    expectedKg: 97.5,
    acceptableKg: [97.5],
    holdWithReason: 100,
    reason: 'miss below the floor even by capacity (BR-TRAINING-043)',
  };
  const ex = (proposedKg: number | null, reasonStated: boolean): WeightExtraction => ({
    exercise: 'Barbell Back Squat',
    proposedKg,
    asked: false,
    reasonStated,
  });

  it('the step down hits; the hold hits ONLY with a stated reason; anything else misses', () => {
    expect(weightHit(ex(97.5, false), missExpectation).hit).toBe(true);
    expect(weightHit(ex(100, true), missExpectation).hit).toBe(true);
    const holdNoReason = weightHit(ex(100, false), missExpectation);
    expect(holdNoReason.hit).toBe(false);
    expect(holdNoReason.detail).toContain('reason');
    expect(weightHit(ex(95, true), missExpectation).hit).toBe(false);
  });

  it('without the alternative (growth cases) the hold does not hit even with a reason', () => {
    const upExpectation: NLoadExpectation = { ...missExpectation, direction: 'up', expectedKg: 82.5, acceptableKg: [82.5] };
    delete (upExpectation as Partial<NLoadExpectation>).holdWithReason;
    expect(weightHit(ex(80, true), upExpectation).hit).toBe(false);
  });
});

// --- the judge prompt carries the reply (live verdicts said "reply empty": the client text, the delivered
// reply and the tool names were never appended) and the request context comes from the COACH call ---

describe('buildJudgePrompt — the evidence reaches the judge', () => {
  const fixture = readFileSync(join(__dirname, 'fixtures', 'candidate-b-full-workout.md'), 'utf8');
  const step = parseTranscriptMarkdown(fixture).steps.find(s => s.userText !== '' && s.delivered !== '')!;

  it('contains the client message, the delivered reply and the tool names of a real fixture step', () => {
    const prompt = buildJudgePrompt(
      { scenarioId: 'b', stepIndex: step.stepIndex, userText: step.userText, delivered: step.delivered, tools: ['log_set'], requestContext: 'CTX', coachSystem: '', toolCallsWithArgs: '' },
      'RUBRIC',
    );
    expect(step.userText).not.toBe('');
    expect(prompt).toContain(step.userText);
    expect(prompt).toContain(step.delivered);
    expect(prompt).toContain('log_set');
    expect(prompt.indexOf(step.userText)).toBeGreaterThan(prompt.indexOf("## The client's message"));
    expect(prompt.trimEnd().endsWith('Output the JSON object only.')).toBe(true);
  });
});

describe('pickCoachContext — the coach call, not the last stored call', () => {
  const coachRequest = { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi\n<context>\n# LOAD PLAN\n</context>' }] };
  const courseCheckRequest = { messages: [{ role: 'user', content: 'Course-check directive: is the client on course?' }] };
  const rows = [
    { callIndex: 0, request: coachRequest, response: { toolCalls: [{ name: 'log_set', args: { reps: 8 } }] } },
    { callIndex: 1, request: courseCheckRequest, response: { toolCalls: null } },
  ];

  it('skips a trailing call whose request has no <context> block', () => {
    expect(pickCoachContext(rows)).toContain('# LOAD PLAN');
    expect(pickCoachContext(rows)).not.toContain('Course-check');
  });

  it('is empty when no call carries a <context> block', () => {
    expect(pickCoachContext([rows[1]!])).toBe('');
  });
});

// --- "What the coach knew": the system message (profile, history, NOW) reaches the judge ---

describe('system message evidence', () => {
  const systemRow = (hash: string) => ({
    callIndex: 0,
    request: { messages: [{ role: 'system', contentHash: hash }, { role: 'user', content: 'hi\n<context>\nNOW: Mon 2026-09-21 18:00\n</context>' }] },
    response: null,
  });

  it('resolveSystemText resolves a hashed system message from the blobs', () => {
    const blobs = new Map<string, string | null>([['h1', 'Client: Alex, goal: strength']]);
    expect(resolveSystemText(systemRow('h1').request, blobs)).toBe('Client: Alex, goal: strength');
  });

  it('says so when the blob is missing or aged out (never an empty string)', () => {
    expect(resolveSystemText(systemRow('h2').request, new Map([['h2', null]]))).toContain('aged out');
    expect(resolveSystemText(systemRow('h3').request, new Map())).toContain('not found');
  });

  it('keeps an inline system message as is', () => {
    expect(resolveSystemText({ messages: [{ role: 'system', content: 'inline' }] }, new Map())).toBe('inline');
  });

  it('pickCoachCall returns the coach row, not the trailing course-check row', () => {
    const coach = systemRow('h1');
    const check = { callIndex: 1, request: { messages: [{ role: 'user', content: 'Course-check directive' }] }, response: null };
    expect(pickCoachCall([coach, check])).toBe(coach);
    expect(pickCoachCall([check])).toBeUndefined();
  });

  it('parseRequestsSidecar carries coachSystem; an old sidecar without it reads empty', () => {
    const raw = JSON.stringify({
      r1: { requestContext: 'ctx', coachSystem: 'SYS Alex', toolCalls: [] },
      r2: { requestContext: 'ctx', toolCalls: [] },
    });
    const parsed = parseRequestsSidecar(raw);
    expect(parsed.get('r1')!.coachSystem).toBe('SYS Alex');
    expect(parsed.get('r2')!.coachSystem).toBe('');
  });

  it('the judge prompt shows the system message under "What the coach knew" and says the clock is the request\'s', () => {
    const prompt = buildJudgePrompt(
      { scenarioId: 's', stepIndex: 1, userText: 'u', delivered: 'd', tools: [], requestContext: 'CTX', coachSystem: 'Client: Alex\n# History\nNOW 2026-09-21', toolCallsWithArgs: '' },
      'RUBRIC',
    );
    const at = prompt.indexOf('## What the coach knew');
    expect(at).toBeGreaterThan(-1);
    expect(prompt.indexOf('Client: Alex')).toBeGreaterThan(at);
    expect(prompt).toMatch(/fake clock|not the real date/);
  });
});
