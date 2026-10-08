/**
 * The coach-quality judge (coach-quality-proof T3 / AC-CQ-3) — PREPARATION,
 * no live run wired here: the orchestrator launches the L3 run and then this
 * script over its transcripts.
 *
 * Per coach reply of an L3 run it assembles the evidence — the delivered text
 * and the run's tool calls from the L3 transcript (evals/reports/
 * <scenario>-<ISO>.md, reporter.formatScenarioTranscript's format, which
 * carries the run id), plus what the COACH call saw: its resolved system
 * message (profile, rules) and its user message with the `<context>` block —
 * the last call carrying one, not simply the last stored call (the
 * `<transcript>.requests.json` sidecar the L3 runner writes right after
 * each scenario — evals/lib/write-requests-sidecar.ts; llm_calls is only the
 * fallback, its rows die at every jest DB reset on this host). The prompt also
 * says the clock is the request's fake clock, not the real date. It asks a
 * judge CLI (env JUDGE_CMD, default `claude-glm -p --model glm-5.3`) for ONE
 * JSON verdict on the fixed rubric (evals/rubrics/coach-quality.md). Bad JSON
 * is retried exactly once.
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

import { argValue, closePool } from '../lib/cli-args';
import { parseTranscriptMarkdown, type ParsedTranscript, type TranscriptStep } from '../lib/transcript-parser';
import { collectRunEvidence, formatToolCallLine } from '../lib/write-requests-sidecar';
import { BENCH_PRESS_ID } from '../scenarios/b-full-workout.scenario';
import { nLoadExpectations, type NLoadExpectation } from '../scenarios/n-load-shared';

// --- the pure core (unit-tested) ---------------------------------------------------------------

/** The T2 extraction the rubric asks for alongside the scores. */
export interface WeightExtraction {
  exercise: string | null;
  proposedKg: number | null;
  asked: boolean;
  /** The reply states its load choice and the reason in one phrase (the miss CHOICE, owner 2026-10-08). */
  reasonStated: boolean;
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
    extraction: { exercise, proposedKg: kgOf(e['proposedKg']), asked: e['asked'] === true, reasonStated: e['reasonStated'] === true },
    note: typeof v['note'] === 'string' ? v['note'] : '',
  };
}

export interface WeightHitResult {
  scenarioId: string;
  exercise: string;
  hit: boolean;
  detail: string;
}

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** A naming slip is not a progression miss: case/whitespace-insensitive match on the name, the catalog id or an alias. */
function exerciseMatches(extracted: string, expectation: NLoadExpectation): boolean {
  const wanted = [expectation.exercise, expectation.exerciseId ?? '', ...(expectation.aliases ?? [])]
    .filter(n => n !== '')
    .map(normalizeName);
  return wanted.includes(normalizeName(extracted));
}

/** The weight-hit-rate cell: judged hits over judged asks, with the asks the judge could not judge said aloud. */
export function hitRateLine(hits: number, judged: number, unjudged: number): string {
  const rate = judged > 0 ? String(hits / judged) : 'n/a';
  return `${rate} (${hits}/${judged} judged, ${unjudged} unjudged)`;
}

/**
 * The T2 weight-hit computation: the judge's extraction against the oracle's
 * expectation for the same case. `ask` expects the coach to ask (BR-TRAINING-036:
 * with no reference the coach does not invent a number); otherwise the proposed
 * load must be one the rules allow (acceptableKg).
 */
export function weightHit(extraction: WeightExtraction, expectation: NLoadExpectation): WeightHitResult {
  if (extraction.exercise !== null && !exerciseMatches(extraction.exercise, expectation)) {
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
  // The miss CHOICE (owner 2026-10-08): holding the working weight with a stated lower rep
  // target is as acceptable as the step down.
  if (
    expectation.holdWithReason !== undefined &&
    extraction.proposedKg !== null &&
    Math.abs(expectation.holdWithReason - extraction.proposedKg) < 1e-9
  ) {
    return extraction.reasonStated
      ? { scenarioId: expectation.scenarioId, exercise: expectation.exercise, hit: true, detail: `held ${extraction.proposedKg} kg with a stated reason — an accepted choice; ${expected}` }
      : {
          scenarioId: expectation.scenarioId,
          exercise: expectation.exercise,
          hit: false,
          detail: `held ${extraction.proposedKg} kg without stating a lower rep target and its reason — ${expected}, or hold with a reason`,
        };
  }
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
  extraction: { exercise: 'Barbell Bench Press', proposedKg: 82.5, asked: false, reasonStated: false },
  note: 'stub verdict (dry run)',
};

/** One reply's evidence handed to the judge. */
export interface Evidence {
  scenarioId: string;
  stepIndex: number;
  userText: string;
  delivered: string;
  tools: string[];
  /** The <context>-carrying user message of the run's coach call, best effort. */
  requestContext: string;
  /** The coach call's resolved system message: client profile, history, rules. */
  coachSystem: string;
  /** Every tool call of the run with arguments, as stored in llm_calls responses. */
  toolCallsWithArgs: string;
}

/**
 * The run's tool-call lines plus a name-only line for every tool the transcript names for the step but the
 * stored lines lack (an old or partial sidecar): a "logged" claim is judged against the run's full tool list.
 */
export function withStepTools(toolCallsWithArgs: string, stepTools: readonly string[]): string {
  const lines = toolCallsWithArgs === '' ? [] : toolCallsWithArgs.split('\n');
  const stored = new Set(lines.map(line => line.split(' ')[0]));
  const missing = [...new Set(stepTools)].filter(name => !stored.has(name));
  return [...lines, ...missing.map(name => `${name} (arguments not stored)`)].join('\n');
}

export function buildJudgePrompt(evidence: Evidence, rubric: string): string {
  return [
    rubric,
    '',
    '---',
    'Judge THIS coach reply. Evidence:',
    '',
    'Note: eval runs use a fake clock. "Today", the weekday and the time are the ones the request below states,',
    'not the real date; names, goals, history and dates the request states are facts, not inventions.',
    '',
    '## What the coach knew (the system message of the coach call: client profile, history, rules)',
    '```',
    evidence.coachSystem === '' ? '(system message unavailable)' : evidence.coachSystem,
    '```',
    '',
    '## The request the model was shown (the coach call\'s user message)',
    '```',
    evidence.requestContext,
    '```',
    '',
    '## The run\'s tool calls (name + arguments) — every model call of the run, not only the coach call',
    '```',
    evidence.toolCallsWithArgs === '' ? '(none)' : evidence.toolCallsWithArgs,
    '```',
    '',
    '## The client\'s message',
    evidence.userText,
    '',
    '## The coach reply delivered to the client',
    evidence.delivered === '' ? '(no delivered text)' : evidence.delivered,
    '',
    '## Tools the coach called in this step',
    evidence.tools.length === 0 ? '(none)' : evidence.tools.join(', '),
    '',
    'Output the JSON object only.',
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

/** The judge-side view of one run's sidecar entry. */
export interface SidecarEvidence {
  requestContext: string;
  coachSystem: string;
  toolCallsWithArgs: string;
}

/**
 * Parses a `<transcript>.requests.json` sidecar (written by the L3 runner via
 * evals/lib/write-requests-sidecar.ts): `{ [runId]: { requestContext, toolCalls } | { error } }`.
 * Entries with an error, or a malformed file, are skipped — the judge then
 * falls back to reading llm_calls directly.
 */
export function parseRequestsSidecar(raw: string): Map<string, SidecarEvidence> {
  const out = new Map<string, SidecarEvidence>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return out;
  }
  for (const [runId, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null || !('requestContext' in entry)) {
      continue;
    }
    const e = entry as { requestContext?: unknown; coachSystem?: unknown; toolCalls?: unknown };
    const calls = Array.isArray(e.toolCalls)
      ? e.toolCalls
          .map((c: { name?: unknown; args?: unknown }) => formatToolCallLine(c))
          .join('\n')
      : '';
    out.set(runId, {
      requestContext: typeof e.requestContext === 'string' ? e.requestContext : '',
      coachSystem: typeof e.coachSystem === 'string' ? e.coachSystem : '',
      toolCallsWithArgs: calls,
    });
  }
  return out;
}

/** Reads a transcript's sidecar when it exists — empty map otherwise (DB fallback then). */
function readSidecar(transcriptPath: string): Map<string, SidecarEvidence> {
  const sidecarPath = `${transcriptPath}.requests.json`;
  return existsSync(sidecarPath) ? parseRequestsSidecar(readFileSync(sidecarPath, 'utf8')) : new Map();
}

/** Best-effort evidence from llm_calls for one run (dynamic import — no DB at unit-test time). */
async function loadRunEvidence(runId: string): Promise<SidecarEvidence> {
  try {
    const stored = await collectRunEvidence(runId);
    return {
      requestContext: stored.requestContext || '(stored request unavailable)',
      coachSystem: stored.coachSystem,
      toolCallsWithArgs: stored.toolCalls.map(formatToolCallLine).join('\n'),
    };
  } catch {
    return { requestContext: '(stored request unavailable)', coachSystem: '', toolCallsWithArgs: '' };
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
  `- Barbell Bench Press [id ${BENCH_PRESS_ID}] — plan 3×8-10 — nothing yet`,
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

/** One judged input: a parsed transcript, its dry-run contexts, and its requests sidecar (when present). */
interface JudgeInput {
  file: string;
  parsed: ParsedTranscript;
  contexts: Map<number, string>;
  sidecar: Map<string, SidecarEvidence>;
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
  const inputs: JudgeInput[] = [];
  if (dryRun) {
    inputs.push(...canned.map(c => ({ ...c, sidecar: new Map<string, SidecarEvidence>() })));
  } else {
    const reportsDir = argValue('--reports-dir', join(process.cwd(), 'evals', 'reports'));
    const stamp = argValue('--stamp', '');
    for (const p of transcriptPaths) {
      inputs.push({
        file: basename(p),
        parsed: parseTranscriptMarkdown(readFileSync(p, 'utf8')),
        contexts: new Map(),
        sidecar: readSidecar(p),
      });
    }
    if (stamp !== '') {
      const { readdirSync } = await import('node:fs');
      for (const name of readdirSync(reportsDir).filter(n => n.endsWith(`-${stamp}.md`))) {
        const path = join(reportsDir, name);
        inputs.push({
          file: name,
          parsed: parseTranscriptMarkdown(readFileSync(path, 'utf8')),
          contexts: new Map(),
          sidecar: readSidecar(path),
        });
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
  let unjudgedAsks = 0;
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
        coachSystem: dryRun ? '(dry run: canned system message)' : '',
        toolCallsWithArgs: step.tools.join(', '),
      };
      // The sidecar first (durable, written by the L3 runner right after the
      // run); the DB only when it is absent — llm_calls rows die at the next
      // jest DB reset on this host.
      const sidecarEvidence = step.runId !== null ? input.sidecar.get(step.runId) : undefined;
      if (sidecarEvidence !== undefined) {
        evidence.requestContext = sidecarEvidence.requestContext;
        evidence.coachSystem = sidecarEvidence.coachSystem;
        evidence.toolCallsWithArgs = sidecarEvidence.toolCallsWithArgs;
      } else if (!dryRun && step.runId !== null) {
        const stored = await loadRunEvidence(step.runId);
        evidence.requestContext = stored.requestContext;
        evidence.coachSystem = stored.coachSystem;
        evidence.toolCallsWithArgs = stored.toolCallsWithArgs;
      }
      evidence.toolCallsWithArgs = withStepTools(evidence.toolCallsWithArgs, step.tools);
      const outcome = judgeReplyVia(evidence, rubric, cliSpawn, judgeCmd, fallbackCmd);
      const record = { file: input.file, scenarioId: input.parsed.scenarioId, stepIndex: step.stepIndex, evidence, outcome };
      runReplies.push(record);
      appendFileSync(verdictsPath, `${JSON.stringify({ ...record, evidence: undefined })}\n`);
      const expectation = isNLoadAskStep(input.parsed.scenarioId, step.userText, expectations);
      if ('unjudged' in outcome) {
        if (expectation !== null) {
          unjudgedAsks += 1; // an ask the judge could not read is not a hit nor a miss — but it is counted
        }
        continue; // one refused or mangled reply never aborts the run
      }
      if (expectation !== null) {
        hits.push(weightHit(outcome.verdict.extraction, expectation));
      }
    }
  }

  const summary = summarizeRun(runReplies, totalSteps);
  const judged = runReplies.filter((r): r is typeof r & { outcome: { verdict: JudgeVerdict; raw: string; usedFallback: boolean } } => !('unjudged' in r.outcome));
  const hitCount = hits.filter(h => h.hit).length;
  writeFileSync(
    join(outDir, `coach-quality-${stamp}.json`),
    JSON.stringify(
      {
        summary,
        weightHits: hits,
        unjudgedAsks,
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
    `| weight hit rate (T2) | ${hitRateLine(hitCount, hits.length, unjudgedAsks)} |`,
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
    await closePool();
  } catch {
    // no pool was opened (dry run) — nothing to close
  }
  process.exit(code);
}
