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
 * Outputs: evals/reports/judge/coach-quality-<stamp>.verdicts.jsonl (every
 * verdict appended AS IT IS PRODUCED — a crash loses nothing already judged),
 * the full .json and the summary .md at the end (rubric means over the judged
 * replies only, every honesty failure quoted, weight hits/misses, the unjudged
 * replies with reasons). A judge-CLI failure on one reply (the baseline run's
 * `[1301]` content refusal) never aborts the run: JUDGE_FALLBACK_CMD judges
 * that reply once, else it is recorded unjudged. --dry-run judges two canned
 * replies through a stub JUDGE_CMD — no DB, no model.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** One reply's judged-or-unjudged outcome, with its transcript coordinates. */
export interface RunReply {
  file: string;
  scenarioId: string;
  stepIndex: number;
  outcome: JudgementOutcome;
}

/** The whole run's numbers: means over the JUDGED replies only, unjudged and fallback use counted apart. */
export interface RunSummary {
  totalSteps: number;
  judgedCount: number;
  /** The rubric means — computed over the judged replies only. */
  means: JudgeSummary;
  unjudged: Array<{ file: string; scenarioId: string; stepIndex: number; reason: string }>;
  fallbackUsed: number;
  /** One line for the report: what the means cover. */
  exclusionNote: string;
}

export function summarizeRun(replies: RunReply[], totalSteps: number): RunSummary {
  const judged = replies.filter((r): r is RunReply & { outcome: { verdict: JudgeVerdict; raw: string; usedFallback: boolean } } => !('unjudged' in r.outcome));
  const unjudged = replies
    .filter(r => 'unjudged' in r.outcome)
    .map(r => ({ file: r.file, scenarioId: r.scenarioId, stepIndex: r.stepIndex, reason: (r.outcome as { reason: string }).reason }));
  const fallbackUsed = judged.filter(r => r.outcome.usedFallback).length;
  return {
    totalSteps,
    judgedCount: judged.length,
    means: summarizeVerdicts(judged.map(r => ({ scenarioId: r.scenarioId, stepIndex: r.stepIndex, verdict: r.outcome.verdict }))),
    unjudged,
    fallbackUsed,
    exclusionNote:
      unjudged.length > 0
        ? `Rubric means cover the ${judged.length} judged replies; ${unjudged.length} unjudged ${unjudged.length === 1 ? 'reply is' : 'replies are'} excluded.`
        : `Rubric means cover all ${judged.length} judged replies.`,
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
export interface Evidence {
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

/** One judge-CLI invocation: stdout, or the failure (the baseline run saw the CLI refuse one reply, exit non-zero). */
export type SpawnOutcome = { ok: true; raw: string } | { ok: false; error: string };

/** One judge-CLI invocation through a command — injectable so tests stub it (no real model). */
export type JudgeSpawn = (prompt: string, command: string) => SpawnOutcome;

/** What came of judging one reply: a verdict (with whether the fallback judged it) or an unjudged record. */
export type JudgementOutcome = { verdict: JudgeVerdict; raw: string; usedFallback: boolean } | { unjudged: true; reason: string };

/**
 * Calls the judge CLI once: the prompt goes to stdin, the answer comes from
 * stdout (JUDGE_CMD is a shell command; `claude-glm -p` prints the reply). A
 * non-zero exit (e.g. GLM's `[1301]` content refusal) is a failed call, never
 * a thrown error — one bad reply must not abort the run.
 */
function cliSpawn(prompt: string, judgeCmd: string): SpawnOutcome {
  try {
    return {
      ok: true,
      raw: execFileSync('/bin/sh', ['-c', judgeCmd], { input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Judges one reply and NEVER throws. Policy:
 * - the primary command gets two attempts when its OUTPUT is bad JSON (a flake
 *   worth one retry) but NO retry when the CALL fails — a content refusal such
 *   as `[1301]` is deterministic, retrying the same prompt wastes a call;
 * - a fallback command (JUDGE_FALLBACK_CMD) then judges the reply once, any
 *   failure mode;
 * - without a fallback (or when it fails too) the reply is recorded as
 *   `{unjudged: true, reason}` and the run continues.
 */
export function judgeReplyVia(
  evidence: Evidence,
  rubric: string,
  spawn: JudgeSpawn,
  primaryCmd: string,
  fallbackCmd?: string,
): JudgementOutcome {
  const prompt = buildJudgePrompt(evidence, rubric);
  let lastFailure = 'no judge call was made';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const call = spawn(prompt, primaryCmd);
    if (!call.ok) {
      // A failed call is not retried on the same command — go to the fallback.
      lastFailure = `judge CLI failed: ${call.error}`;
      break;
    }
    const verdict = parseJudgeVerdict(call.raw);
    if (verdict !== null) {
      return { verdict, raw: call.raw, usedFallback: false };
    }
    lastFailure = 'judge output was not valid JSON (after one retry)';
  }
  if (fallbackCmd === undefined) {
    return { unjudged: true, reason: lastFailure };
  }
  const fallbackCall = spawn(prompt, fallbackCmd);
  if (!fallbackCall.ok) {
    return { unjudged: true, reason: `judge CLI failed: ${fallbackCall.error} (fallback too)` };
  }
  const verdict = parseJudgeVerdict(fallbackCall.raw);
  return verdict !== null
    ? { verdict, raw: fallbackCall.raw, usedFallback: true }
    : { unjudged: true, reason: 'fallback judge output was not valid JSON' };
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
  /** JUDGE_FALLBACK_CMD judges a reply the primary refused or mangled — else that reply is recorded unjudged. */
  const fallbackCmd = process.env.JUDGE_FALLBACK_CMD !== '' ? process.env.JUDGE_FALLBACK_CMD : undefined;
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
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(outDir, { recursive: true });
  /** Incremental: every verdict (or unjudged record) lands here as it is produced — a crash loses nothing judged. */
  const verdictsPath = join(outDir, `coach-quality-${stamp}.verdicts.jsonl`);
  writeFileSync(verdictsPath, '');
  const runReplies: Array<RunReply & { evidence: Evidence; outcome: JudgementOutcome; raw?: string }> = [];
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
      const outcome = judgeReplyVia(evidence, rubric, cliSpawn, judgeCmd, fallbackCmd);
      const record = { file: input.file, scenarioId: input.parsed.scenarioId, stepIndex: step.stepIndex, evidence, outcome };
      runReplies.push(record);
      appendFileSync(verdictsPath, `${JSON.stringify({ ...record, evidence: undefined })}\n`);
      if ('unjudged' in outcome) {
        continue; // one refused or mangled reply never aborts the run
      }
      const expectation = isNLoadAskStep(input.parsed.scenarioId, step.userText, expectations);
      if (expectation !== null) {
        hits.push(weightHit(outcome.verdict.extraction, expectation));
      }
    }
  }

  const summary = summarizeRun(runReplies, totalSteps);
  const judged = runReplies.filter((r): r is typeof r & { outcome: { verdict: JudgeVerdict; raw: string; usedFallback: boolean } } => !('unjudged' in r.outcome));
  const hitRate = hits.length > 0 ? hits.filter(h => h.hit).length / hits.length : 0;
  writeFileSync(
    join(outDir, `coach-quality-${stamp}.json`),
    JSON.stringify(
      {
        summary,
        weightHits: hits,
        replies: judged.map(j => ({
          file: j.file,
          scenarioId: j.scenarioId,
          stepIndex: j.stepIndex,
          userText: j.evidence.userText,
          delivered: j.evidence.delivered,
          verdict: j.outcome.verdict,
          usedFallback: j.outcome.usedFallback,
          rawJudgeOutput: j.outcome.raw,
        })),
      },
      null,
      2,
    ),
  );

  // Zero judged replies would otherwise print NaN — the dash says it instead.
  const fmt = (value: number): string => (Number.isNaN(value) ? '—' : String(value));

  const md: string[] = [
    `# Coach quality — judged ${new Date().toISOString()}${dryRun ? ' (DRY RUN: canned replies, stub judge)' : ''}`,
    '',
    `Replies judged: ${summary.judgedCount} of ${summary.totalSteps} steps` +
      (summary.fallbackUsed > 0 ? ` (${summary.fallbackUsed} via the fallback judge)` : '') +
      `; ${summary.unjudged.length} unjudged.`,
    `**${summary.exclusionNote}**`,
    '',
    `| dimension | result |`,
    `|---|---|`,
    `| friendly/supportive (0–2, mean) | ${fmt(summary.means.friendlyMean)} |`,
    `| honest (rate) | ${fmt(summary.means.honestRate)} |`,
    `| coaching logic (0–2, mean) | ${fmt(summary.means.coachingLogicMean)} |`,
    `| brevity (rate) | ${fmt(summary.means.brevityRate)} |`,
    `| weight hit rate (T2) | ${hitRate} (${hits.filter(h => h.hit).length}/${hits.length}) |`,
    '',
    '## Honesty failures (every one quoted)',
    ...(summary.means.honestyFailures.length > 0
      ? summary.means.honestyFailures.flatMap(f => [
          `- **${f.scenarioId} step ${f.stepIndex}** — "${f.span ?? '(span not quoted)'}"${f.note !== '' ? ` — ${f.note}` : ''}`,
        ])
      : ['(none)']),
    '',
    '## Weight hits (T2)',
    ...(hits.length > 0 ? hits.map(h => `- ${h.hit ? '✓' : '✗'} ${h.detail}`) : ['(no n-load ask steps in this run)']),
    '',
    '## Unjudged replies (the judge CLI failed or its output did not parse)',
    ...(summary.unjudged.length > 0
      ? summary.unjudged.flatMap(u => [`- **${u.file} ${u.scenarioId} step ${u.stepIndex}** — ${u.reason}`])
      : ['(none)']),
    '',
  ];
  writeFileSync(join(outDir, `coach-quality-${stamp}.md`), md.join('\n'));
  console.log(md.join('\n'));
  console.log(`(written: ${verdictsPath} and ${join(outDir, `coach-quality-${stamp}.json`)} and .md)`);
  return summary.unjudged.length > 0 ? 1 : 0;
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
