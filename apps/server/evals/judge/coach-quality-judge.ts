/**
 * The coach-quality judge (coach-quality-proof T3 / AC-CQ-3) — PREPARATION,
 * no live run wired here: the orchestrator launches the L3 run and then this
 * script over its transcripts.
 *
 * Per coach reply of an L3 run it assembles the evidence — the delivered text
 * and the run's tool calls from the L3 transcript (evals/reports/
 * <scenario>-<ISO>.md, reporter.formatScenarioTranscript's format, which
 * carries the run id), plus the stored request of the run's last model call
 * (llm_calls: the user message with its <context> facts, and every response's
 * tool calls with arguments) — and asks a judge CLI (env JUDGE_CMD, default
 * `claude-glm -p --model glm-5.3`) for ONE JSON verdict on the fixed rubric
 * (evals/rubrics/coach-quality.md). Bad JSON is retried exactly once.
 *
 * For the n-load journeys the T2 weight-hit computation compares the verdict's
 * extraction against nLoadExpectations() — the loads the weight oracle
 * computed from the seeded histories.
 *
 * Outputs: evals/reports/judge/<scenario>-<stamp>.json (every verdict with its
 * evidence pointers) and evals/reports/judge/coach-quality-<stamp>.md (rubric
 * means, every honesty failure quoted, weight hits/misses). --dry-run judges
 * two canned replies through a stub JUDGE_CMD — no DB, no model.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { nLoadExpectations, type NLoadExpectation } from '../scenarios/n-load-shared';

// --- the pure core (unit-tested) ---------------------------------------------------------------

/** One user step of an L3 transcript, as the judge needs it. */
export interface TranscriptStep {
  stepIndex: number;
  userText: string;
  delivered: string;
  tools: string[];
  runId: string | null;
  phase: string | null;
}

export interface ParsedTranscript {
  scenarioId: string;
  steps: TranscriptStep[];
}

/** `coach: ` lines are prefixed with 7 spaces on continuation (reporter.withContinuation). */
const COACH_PAD = ' '.repeat('coach: '.length);

/**
 * Parses one `<scenario>-<ISO>.md` L3 transcript. Only `#N user:` steps come
 * out; advance steps, check lines and the trailing summary are not the judge's
 * concern. Delivered multi-line text is re-joined without the padding.
 */
export function parseTranscriptMarkdown(md: string): ParsedTranscript {
  const lines = md.split('\n');
  const scenarioId = /^## (.+)$/.exec(lines[0] ?? '')?.[1] ?? '';
  const steps: TranscriptStep[] = [];
  let current: { step: TranscriptStep; coachLines: string[] } | null = null;
  const finishCoach = (): void => {
    if (current !== null && current.coachLines.length > 0) {
      current.step.delivered = current.coachLines.join('\n');
    }
    current = null;
  };
  for (const line of lines.slice(1)) {
    const userMatch = /^#(\d+) user: ?(.*)$/.exec(line);
    if (userMatch !== null) {
      finishCoach();
      current = {
        step: {
          stepIndex: Number(userMatch[1]),
          userText: userMatch[2] ?? '',
          delivered: '',
          tools: [],
          runId: null,
          phase: null,
        },
        coachLines: [],
      };
      steps.push(current.step);
      continue;
    }
    if (current === null) {
      continue;
    }
    if (line.startsWith('coach: ')) {
      const text = line.slice('coach: '.length);
      current.coachLines.push(text === '(no delivered text)' ? '' : text);
      continue;
    }
    if (line.startsWith(COACH_PAD)) {
      current.coachLines.push(line.slice(COACH_PAD.length));
      continue;
    }
    if (line.startsWith('tools: ')) {
      const names = line.slice('tools: '.length);
      current.step.tools = names === '(none)' ? [] : names.split(', ').map(n => n.trim()).filter(n => n !== '');
      continue;
    }
    if (line.startsWith('run: ')) {
      current.step.runId = line.slice('run: '.length).trim();
      continue;
    }
    if (line.startsWith('phase: ')) {
      current.step.phase = line.slice('phase: '.length).trim();
      finishCoach();
      continue;
    }
  }
  finishCoach();
  return { scenarioId, steps };
}

/** The T2 extraction the rubric asks for alongside the scores. */
export interface WeightExtraction {
  exercise: string | null;
  proposedKg: number | null;
  asked: boolean;
}

export interface JudgeVerdict {
  friendly: number;
  honest: number;
  honestySpan: string | null;
  coachingLogic: number;
  brevity: number;
  extraction: WeightExtraction;
  note: string;
}

/** The rubric's bounds — everything outside is a bad verdict, not a low score. */
const BOUNDS: Record<'friendly' | 'honest' | 'coachingLogic' | 'brevity', [number, number]> = {
  friendly: [0, 2],
  honest: [0, 1],
  coachingLogic: [0, 2],
  brevity: [0, 1],
};

const intIn = (value: unknown, [min, max]: [number, number]): number | null => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const kgOf = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

/**
 * Parses the judge's answer: a bare JSON object, or one fenced ```json block
 * (models wrap despite the instruction). Anything else — wrong ranges, missing
 * keys, prose — is null, and the caller retries exactly once.
 */
export function parseJudgeVerdict(raw: string): JudgeVerdict | null {
  const trimmed = raw.trim();
  const fenced = /```json\s*([\s\S]*?)\s*```/.exec(trimmed);
  const candidate = fenced !== null ? fenced[1]! : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const v = parsed as Record<string, unknown>;
  const scores = {
    friendly: intIn(v['friendly'], BOUNDS.friendly),
    honest: intIn(v['honest'], BOUNDS.honest),
    coachingLogic: intIn(v['coachingLogic'], BOUNDS.coachingLogic),
    brevity: intIn(v['brevity'], BOUNDS.brevity),
  };
  if (Object.values(scores).some(s => s === null)) {
    return null;
  }
  const extractionRaw = v['extraction'];
  if (typeof extractionRaw !== 'object' || extractionRaw === null) {
    return null;
  }
  const e = extractionRaw as Record<string, unknown>;
  const exercise = typeof e['exercise'] === 'string' && e['exercise'].trim() !== '' ? e['exercise'] : null;
  const honestySpan =
    scores.honest === 0 ? (typeof v['honestySpan'] === 'string' && v['honestySpan'] !== '' ? v['honestySpan'] : null) : null;
  return {
    friendly: scores.friendly!,
    honest: scores.honest!,
    honestySpan,
    coachingLogic: scores.coachingLogic!,
    brevity: scores.brevity!,
    extraction: { exercise, proposedKg: kgOf(e['proposedKg']), asked: e['asked'] === true },
    note: typeof v['note'] === 'string' ? v['note'] : '',
  };
}

export interface WeightHitResult {
  scenarioId: string;
  exercise: string;
  hit: boolean;
  detail: string;
}

/**
 * The T2 weight-hit computation: the judge's extraction against the oracle's
 * expectation for the same case. `ask` expects the coach to ask (BR-TRAINING-036:
 * with no reference the coach does not invent a number); otherwise the proposed
 * load must be one the rules allow (acceptableKg).
 */
export function weightHit(extraction: WeightExtraction, expectation: NLoadExpectation): WeightHitResult {
  if (extraction.exercise !== null && extraction.exercise !== expectation.exercise) {
    return {
      scenarioId: expectation.scenarioId,
      exercise: expectation.exercise,
      hit: false,
      detail: `extraction concerns "${extraction.exercise}", expected ${expectation.exercise}`,
    };
  }
  if (expectation.direction === 'ask') {
    return extraction.asked
      ? { scenarioId: expectation.scenarioId, exercise: expectation.exercise, hit: true, detail: 'asked, as the no-history case requires' }
      : {
          scenarioId: expectation.scenarioId,
          exercise: expectation.exercise,
          hit: false,
          detail: extraction.proposedKg !== null
            ? `proposed ${extraction.proposedKg} kg with no history to take it from (invented — BR-TRAINING-036)`
            : 'neither asked nor proposed a load',
        };
  }
  const expected = `${expectation.direction} → any of [${expectation.acceptableKg.join(', ')}] kg (${expectation.reason})`;
  if (extraction.proposedKg === null) {
    return {
      scenarioId: expectation.scenarioId,
      exercise: expectation.exercise,
      hit: false,
      detail: extraction.asked
        ? `asked instead of proposing — expected ${expected}`
        : `no load in the reply — expected ${expected}`,
    };
  }
  const inSet = expectation.acceptableKg.some(kg => Math.abs(kg - extraction.proposedKg!) < 1e-9);
  return {
    scenarioId: expectation.scenarioId,
    exercise: expectation.exercise,
    hit: inSet,
    detail: inSet
      ? `proposed ${extraction.proposedKg} kg — ${expected}`
      : `proposed ${extraction.proposedKg} kg, expected ${expected}`,
  };
}

export interface JudgedReply {
  scenarioId: string;
  stepIndex: number;
  verdict: JudgeVerdict;
}

export interface JudgeSummary {
  replies: number;
  friendlyMean: number;
  honestRate: number;
  coachingLogicMean: number;
  brevityRate: number;
  honestyFailures: Array<{ scenarioId: string; stepIndex: number; span: string | null; note: string }>;
}

const mean1 = (values: number[]): number => Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

/** Rubric means and rates over every judged reply, with every honesty failure quoted. */
export function summarizeVerdicts(replies: JudgedReply[]): JudgeSummary {
  const verdicts = replies.map(r => r.verdict);
  return {
    replies: replies.length,
    friendlyMean: mean1(verdicts.map(v => v.friendly)),
    honestRate: verdicts.length > 0 ? verdicts.filter(v => v.honest === 1).length / verdicts.length : 0,
    coachingLogicMean: mean1(verdicts.map(v => v.coachingLogic)),
    brevityRate: verdicts.length > 0 ? verdicts.filter(v => v.brevity === 1).length / verdicts.length : 0,
    honestyFailures: replies
      .filter(r => r.verdict.honest === 0)
      .map(r => ({ scenarioId: r.scenarioId, stepIndex: r.stepIndex, span: r.verdict.honestySpan, note: r.verdict.note })),
  };
}

// --- the CLI ------------------------------------------------------------------------------------

const RUBRIC_PATH = join(process.cwd(), 'evals', 'rubrics', 'coach-quality.md');
const DEFAULT_JUDGE_CMD = 'claude-glm -p --model glm-5.3';
/** The --dry-run stub: reads nothing, answers the same canned verdict for every reply. */
const STUB_VERDICT: JudgeVerdict = {
  friendly: 2,
  honest: 1,
  honestySpan: null,
  coachingLogic: 2,
  brevity: 1,
  extraction: { exercise: 'Barbell Bench Press', proposedKg: 82.5, asked: false },
  note: 'stub verdict (dry run)',
};

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

/** One reply's evidence handed to the judge. */
interface Evidence {
  scenarioId: string;
  stepIndex: number;
  userText: string;
  delivered: string;
  tools: string[];
  /** The <context>-carrying user message of the run's last model call, best effort. */
  requestContext: string;
  /** Every tool call of the run with arguments, as stored in llm_calls responses. */
  toolCallsWithArgs: string;
}

function buildJudgePrompt(evidence: Evidence, rubric: string): string {
  return [
    rubric,
    '',
    '---',
    'Judge THIS coach reply. Evidence:',
    '',
    '## The request the model was shown (the last call\'s user message)',
    '```',
    evidence.requestContext,
    '```',
    '',
    '## The run\'s tool calls (name + arguments)',
    '```',
    evidence.toolCallsWithArgs === '' ? '(none)' : evidence.toolCallsWithArgs,
    '```',
    '',
    '## The client\'s message',
  ].join('\n');
}

/**
 * Calls the judge CLI once: the prompt goes to stdin, the answer comes from
 * stdout (JUDGE_CMD is a shell command; `claude-glm -p` prints the reply).
 */
function callJudge(prompt: string, judgeCmd: string): string {
  return execFileSync('/bin/sh', ['-c', judgeCmd], { input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

/** One verdict per reply, retrying bad JSON exactly once. */
function judgeReply(evidence: Evidence, rubric: string, judgeCmd: string): { verdict: JudgeVerdict; raw: string } | null {
  const prompt = buildJudgePrompt(evidence, rubric);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = callJudge(prompt, judgeCmd);
    const verdict = parseJudgeVerdict(raw);
    if (verdict !== null) {
      return { verdict, raw };
    }
  }
  return null;
}

/** The n-load ask step of a case: the user text the case table authored. */
function isNLoadAskStep(scenarioId: string, userText: string, expectations: NLoadExpectation[]): NLoadExpectation | null {
  // The ask text lives in the case table via the scenario module; matching on
  // the scenario id plus the «вес» question keeps this self-contained.
  const expectation = expectations.find(e => e.scenarioId === scenarioId);
  return expectation !== undefined && /вес/i.test(userText) ? expectation : null;
}

interface LlmCallRow {
  callIndex: number;
  request: unknown;
  response: unknown;
}

/** Best-effort evidence from llm_calls for one run (dynamic import — no DB at unit-test time). */
async function loadRunEvidence(runId: string): Promise<{ requestContext: string; toolCallsWithArgs: string }> {
  try {
    const { db } = await import('@infra/db/drizzle');
    const { llmCalls } = await import('@infra/db/schema');
    const { eq } = await import('drizzle-orm');
    const rows = (await db
      .select({ callIndex: llmCalls.callIndex, request: llmCalls.request, response: llmCalls.response })
      .from(llmCalls)
      .where(eq(llmCalls.runId, runId))
      .orderBy(llmCalls.callIndex)) as LlmCallRow[];
    let requestContext = '(stored request unavailable)';
    const toolCalls: string[] = [];
    for (const row of rows) {
      const messages = (row.request as { messages?: Array<{ role: string; content?: unknown }> } | null)?.messages ?? [];
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (lastUser !== undefined && typeof lastUser.content === 'string' && lastUser.content.trim() !== '') {
        requestContext = lastUser.content;
      }
      const calls = (row.response as { toolCalls?: Array<{ name?: unknown; args?: unknown }> | null } | null)?.toolCalls ?? [];
      for (const call of calls) {
        toolCalls.push(`${String(call.name ?? '?')} ${JSON.stringify(call.args ?? {})}`);
      }
    }
    return { requestContext, toolCallsWithArgs: toolCalls.join('\n') };
  } catch {
    return { requestContext: '(stored request unavailable)', toolCallsWithArgs: '' };
  }
}

const DRY_RUN_STEP = (stepIndex: number, userText: string, delivered: string, tools: string[]): TranscriptStep => ({
  stepIndex,
  userText,
  delivered,
  tools,
  runId: `dry-run-${stepIndex}`,
  phase: 'training',
});

const DRY_RUN_CONTEXT = [
  '# Today (sets as reps×kg)',
  '- Barbell Bench Press [id c7b0899c-a0f9-47ca-a69d-4bcd531b0c95] — plan 3×8-10 — nothing yet',
  '# History (before today)',
  'Barbell Bench Press (today 3×8-10)',
  '- 2 days ago, Friday Sep 18: 10×80, 10×80, 10×80 (all RPE 8)',
  '- Loads used: 77.5, 80 kg.',
].join('\n');

/** Two canned replies through the full judge path — no DB, no model. */
function dryRunTranscripts(): Array<{ file: string; parsed: ParsedTranscript; contexts: Map<number, string> }> {
  const nLoadUp: ParsedTranscript = {
    scenarioId: 'n-load-up',
    steps: [
      DRY_RUN_STEP(3, 'какой вес взять на жим?', 'Бери 82.5 кг: две тренировки подряд все подходы по 10 с запасом — пора шагнуть вверх.', []),
      DRY_RUN_STEP(5, 'сделал 82.5 на 10', 'Записал: 82.5 на 10. Отличная работа!', ['log_set']),
    ],
  };
  return [{ file: 'n-load-up-dry-run.md', parsed: nLoadUp, contexts: new Map([[3, DRY_RUN_CONTEXT], [5, DRY_RUN_CONTEXT]]) }];
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run');
  const judgeCmd = process.env.JUDGE_CMD ?? (dryRun ? `printf '%s' ${JSON.stringify(JSON.stringify(STUB_VERDICT))}` : DEFAULT_JUDGE_CMD);
  const outDir = argValue('--out-dir', join(process.cwd(), 'evals', 'reports', 'judge'));
  const rubric = existsSync(RUBRIC_PATH) ? readFileSync(RUBRIC_PATH, 'utf8') : '(rubric file missing)';

  // Inputs: --transcript <path> (repeatable) or --reports-dir + --stamp; dry run uses canned replies.
  const transcriptPaths: string[] = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--transcript' && process.argv[i + 1] !== undefined) {
      transcriptPaths.push(process.argv[i + 1]!);
    }
  }
  const canned = dryRunTranscripts();
  const inputs: Array<{ file: string; parsed: ParsedTranscript; contexts: Map<number, string> }> = [];
  if (dryRun) {
    inputs.push(...canned);
  } else {
    const reportsDir = argValue('--reports-dir', join(process.cwd(), 'evals', 'reports'));
    const stamp = argValue('--stamp', '');
    for (const p of transcriptPaths) {
      inputs.push({ file: basename(p), parsed: parseTranscriptMarkdown(readFileSync(p, 'utf8')), contexts: new Map() });
    }
    if (stamp !== '') {
      const { readdirSync } = await import('node:fs');
      for (const name of readdirSync(reportsDir).filter(n => n.endsWith(`-${stamp}.md`))) {
        inputs.push({ file: name, parsed: parseTranscriptMarkdown(readFileSync(join(reportsDir, name), 'utf8')), contexts: new Map() });
      }
    }
  }
  if (inputs.length === 0) {
    console.error('No transcripts: pass --transcript <path> (repeatable) or --reports-dir + --stamp.');
    return 2;
  }

  const expectations = nLoadExpectations();
  const judged: Array<JudgedReply & { file: string; userText: string; delivered: string; raw: string }> = [];
  const unparsed: Array<{ file: string; stepIndex: number }> = [];
  const hits: WeightHitResult[] = [];
  let totalSteps = 0;

  for (const input of inputs) {
    for (const step of input.parsed.steps) {
      totalSteps += 1;
      const evidence: Evidence = {
        scenarioId: input.parsed.scenarioId,
        stepIndex: step.stepIndex,
        userText: step.userText,
        delivered: step.delivered,
        tools: step.tools,
        requestContext: input.contexts.get(step.stepIndex) ?? (dryRun ? '(dry run: canned context)' : ''),
        toolCallsWithArgs: step.tools.join(', '),
      };
      if (!dryRun && step.runId !== null) {
        const stored = await loadRunEvidence(step.runId);
        evidence.requestContext = stored.requestContext;
        evidence.toolCallsWithArgs = stored.toolCallsWithArgs;
      }
      const result = judgeReply(evidence, rubric, judgeCmd);
      if (result === null) {
        unparsed.push({ file: input.file, stepIndex: step.stepIndex });
        continue;
      }
      judged.push({ file: input.file, scenarioId: input.parsed.scenarioId, stepIndex: step.stepIndex, userText: step.userText, delivered: step.delivered, verdict: result.verdict, raw: result.raw });
      const expectation = isNLoadAskStep(input.parsed.scenarioId, step.userText, expectations);
      if (expectation !== null) {
        hits.push(weightHit(result.verdict.extraction, expectation));
      }
    }
  }

  const summary = summarizeVerdicts(judged);
  const hitRate = hits.length > 0 ? hits.filter(h => h.hit).length / hits.length : 0;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(outDir, { recursive: true });
  const perReply = judged.map(j => ({
    file: j.file,
    scenarioId: j.scenarioId,
    stepIndex: j.stepIndex,
    userText: j.userText,
    delivered: j.delivered,
    verdict: j.verdict,
    rawJudgeOutput: j.raw,
  }));
  writeFileSync(join(outDir, `coach-quality-${stamp}.json`), JSON.stringify({ summary, weightHits: hits, unparsed, replies: perReply }, null, 2));

  const md: string[] = [
    `# Coach quality — judged ${new Date().toISOString()}${dryRun ? ' (DRY RUN: canned replies, stub judge)' : ''}`,
    '',
    `Replies judged: ${summary.replies} of ${totalSteps} steps (${unparsed.length} unparseable judge outputs).`,
    '',
    `| dimension | result |`,
    `|---|---|`,
    `| friendly/supportive (0–2, mean) | ${summary.friendlyMean} |`,
    `| honest (rate) | ${summary.honestRate} |`,
    `| coaching logic (0–2, mean) | ${summary.coachingLogicMean} |`,
    `| brevity (rate) | ${summary.brevityRate} |`,
    `| weight hit rate (T2) | ${hitRate} (${hits.filter(h => h.hit).length}/${hits.length}) |`,
    '',
    '## Honesty failures (every one quoted)',
    ...(summary.honestyFailures.length > 0
      ? summary.honestyFailures.flatMap(f => [`- **${f.scenarioId} step ${f.stepIndex}** — "${f.span ?? '(span not quoted)'}"${f.note !== '' ? ` — ${f.note}` : ''}`])
      : ['(none)']),
    '',
    '## Weight hits (T2)',
    ...(hits.length > 0 ? hits.map(h => `- ${h.hit ? '✓' : '✗'} ${h.detail}`) : ['(no n-load ask steps in this run)']),
    '',
    '## Judge outputs that failed to parse (after one retry)',
    ...(unparsed.length > 0 ? unparsed.map(u => `- ${u.file} step ${u.stepIndex}`) : ['(none)']),
    '',
  ];
  writeFileSync(join(outDir, `coach-quality-${stamp}.md`), md.join('\n'));
  console.log(md.join('\n'));
  console.log(`(written: ${join(outDir, `coach-quality-${stamp}.json`)} and .md)`);
  return unparsed.length > 0 ? 1 : 0;
}

if (process.argv[1]?.endsWith('coach-quality-judge.ts')) {
  void runWithPoolClosed(main);
}

/** The DB evidence path opens a pool (dynamic import); close it before exit so tsx terminates. */
async function runWithPoolClosed(task: () => Promise<number>): Promise<void> {
  const code = await task();
  try {
    const { db } = await import('@infra/db/drizzle');
    await db.$client?.end?.();
  } catch {
    // no pool was opened (dry run) — nothing to close
  }
  process.exit(code);
}
