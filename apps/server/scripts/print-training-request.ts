/**
 * Offline print of the exact training request (coach-simplification I1, AC-CS1-5): the real `TRAINING_COACH`,
 * `# Today` / `# History` blocks, `workoutHistory` and `assembleContext` over data you supply — no DB, no model.
 * Prints the messages, then a size table (characters and estimated tokens per part, the totals, and the tool
 * schemas separately).
 *
 * Run:
 *   npm run print-training-request -- --history <json> --today <json> --at <ISO> [--messages <json>] [--sizes-only]
 *   npm run print-training-request -- [--case07 | --plain] [--sizes-only]     (named in-memory fixtures)
 * Any other flag (or a missing value / file) is an error with this usage — nothing is silently ignored.
 *
 * `--at` is "now" (ISO 8601); `--history`, `--today` and `--at` go together. `--messages` is optional.
 *
 * `--history <json>` — before today; mirrors the loader's `TrainingFactsData` minus today's session:
 *   { "user": { "id"?, "firstName"?, "fitnessLevel"?, "languageCode"?, "timezone"? },
 *     "facts": [ { "category": "physical_constraint", "fact": "…", "muscleGroup"?: "lower_back" } ],
 *     "lastWorkout": { "completedAt": "2026-09-29", "exerciseNames": ["…"] } | null,
 *     "warmupHabit": { "workouts": 10, "withCardio": 9,
 *                      "kinds": [ { "label": "treadmill", "minMinutes": 10, "maxMinutes": 15 } ] } | null,
 *     "exercises": [ { "id": "<uuid>", "name": "…", "planned": "4×12" | null, "lastSkippedAt"?: "<ISO>",
 *                      "performances": [ { "date": "2026-09-27" | "<ISO>", "sets": [ SET, … ] } ] } ] }
 *   `performances` newest first (the loader reads at most three); `planned: null` = off plan.
 *
 * `--today <json>` — today's session:
 *   { "startedAt": "<ISO>", "lastActivityAt"?: "<ISO>", "place"?: "…", "coachReplied"?: true,
 *     "plan": [ { "id": "<uuid>", "name": "…", "sets": 4, "reps": "12" } ],
 *     "exercises": [ { "id": "<uuid>", "name": "…", "status": "pending|in_progress|completed|skipped",
 *                      "sets": [ SET, … ] } ],
 *     "reportedToday": [ { "category": "…", "fact": "…" } ] }
 *
 * SET (one set; "at"? is the ISO time, default = `--at`):
 *   strength { "reps": 12, "weight": 130, "rpe"?: 8, "kind"?: "warmup", "note"?: "…" }
 *   hold     { "holdSeconds": 45 }          cardio { "cardioSeconds": 540, "kind"?: "warmup" }
 *   anything else { "setData": <the stored SetData object>, "rpe"?, "kind"?, "note"? }
 *
 * `--messages <json>` — the checkpointed conversation, oldest first; the LAST element is the client's message that
 * triggers the run (a human message). Include the `start_training_session` call, `workoutHistory` slices it off:
 *   [ { "role": "human", "content": "…" },
 *     { "role": "ai", "content": "…", "toolCalls"?: [ { "name": "log_set", "args"?: { … } } ] },
 *     { "role": "tool", "content": "…" } ]          (a tool message answers the oldest unanswered call)
 */
import { readFileSync } from 'node:fs';

import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import type { ExerciseLastPerformance } from '@domain/training/ports/workout-session.ports';
import type {
  SessionExerciseStatus,
  SessionExerciseWithDetails,
  SessionSet,
  SetData,
  SetKind,
} from '@domain/training/types';
import type { UserFact } from '@domain/user/ports';

import {
  CASE07_FIXTURE,
  PLAIN_FIXTURE,
  assembleTrainingRequest,
  factOf,
  type RequestFixture,
  SetFactory,
  sessionExercise,
  sessionOf,
} from '../src/infra/ai/graph/__tests__/training-request-fixture';
import { collectLoadsUsed, type ExerciseHistory } from '../src/infra/ai/prompts/blocks';
import type { TrainingData } from '../src/infra/ai/graph/phases/training.spec';

const USAGE = `Usage:
  npm run print-training-request -- --history <json> --today <json> --at <ISO> [--messages <json>] [--sizes-only]
  npm run print-training-request -- [--case07 | --plain] [--sizes-only]
JSON shapes: see the header of scripts/print-training-request.ts.`;

class UsageError extends Error {}

// ------------------------------------------------------------------ input shapes (see the header)

interface SetJson {
  reps?: number;
  weight?: number;
  holdSeconds?: number;
  cardioSeconds?: number;
  setData?: SetData;
  rpe?: number | null;
  kind?: SetKind;
  note?: string;
  at?: string;
}
interface FactJson {
  category: UserFact['category'];
  fact: string;
  muscleGroup?: string | null;
}
interface HistoryJson {
  user?: Partial<RequestFixture['user']>;
  facts?: FactJson[];
  lastWorkout?: { completedAt: string; exerciseNames: string[] } | null;
  warmupHabit?: TrainingData['warmupHabit'];
  exercises?: Array<{
    id: string;
    name: string;
    planned: string | null;
    lastSkippedAt?: string | null;
    performances: Array<{ date: string; sets: SetJson[] }>;
  }>;
}
interface TodayJson {
  startedAt: string;
  lastActivityAt?: string;
  place?: string | null;
  coachReplied?: boolean;
  plan?: Array<{ id: string; name: string; sets: number; reps: string }>;
  exercises?: Array<{ id: string; name: string; status: SessionExerciseStatus; sets: SetJson[] }>;
  reportedToday?: FactJson[];
}
interface MessageJson {
  role: 'human' | 'ai' | 'tool';
  content: string;
  toolCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
}

function readJson<T>(flag: string, path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (e) {
    throw new UsageError(`${flag} ${path}: ${(e as Error).message}`);
  }
}

function parseDate(flag: string, v: string): Date {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new UsageError(`${flag}: "${v}" is not a date`);
  }
  return d;
}

// ------------------------------------------------------------------ JSON → domain objects

function toSets(sets: SetJson[], fallbackAt: Date): SessionSet[] {
  const out: SessionSet[] = [];
  sets.forEach((s, i) => {
    const f = new SetFactory(s.at ? new Date(s.at) : fallbackAt);
    let setData: SetData;
    if (s.setData) {
      setData = s.setData;
    } else if (s.holdSeconds !== undefined) {
      setData = { type: 'isometric', duration: s.holdSeconds };
    } else if (s.cardioSeconds !== undefined) {
      setData = { type: 'cardio_duration', duration: s.cardioSeconds };
    } else if (s.reps !== undefined) {
      setData = { type: 'strength', reps: s.reps, weight: s.weight ?? 0, weightUnit: 'kg' };
    } else {
      throw new UsageError(`set #${i + 1} has no reps / holdSeconds / cardioSeconds / setData`);
    }
    const set = f.one(setData, { rpe: s.rpe ?? null, kind: s.kind, note: s.note });
    out.push({ ...set, id: `set-${out.length + 1}`, setNumber: out.length + 1 });
  });
  return out;
}

const factsOf = (rows: FactJson[] | undefined, offset: number): UserFact[] =>
  (rows ?? []).map((r, i) => factOf(offset + i, r.category, r.fact, r.muscleGroup ?? null));

function toMessages(rows: MessageJson[]): { history: BaseMessage[]; current: HumanMessage } {
  const last = rows[rows.length - 1];
  if (!last || last.role !== 'human') {
    throw new UsageError('--messages: the last element must be the client\'s message (role "human")');
  }
  const out: BaseMessage[] = [];
  const open: string[] = [];
  let n = 0;
  for (const m of rows.slice(0, -1)) {
    n += 1;
    if (m.role === 'human') {
      out.push(new HumanMessage({ content: m.content, id: `m${n}` }));
    } else if (m.role === 'ai') {
      const calls = (m.toolCalls ?? []).map((c, i) => ({ id: `call-${n}-${i}`, name: c.name, args: c.args ?? {} }));
      open.push(...calls.map(c => c.id));
      out.push(new AIMessage({ content: m.content, id: `m${n}`, tool_calls: calls }));
    } else {
      const callId = open.shift();
      if (!callId) {
        throw new UsageError(`--messages #${n}: a tool message with no unanswered tool call before it`);
      }
      out.push(new ToolMessage({ content: m.content, tool_call_id: callId, id: `m${n}` }));
    }
  }
  return { history: out, current: new HumanMessage({ content: last.content, id: 'cur' }) };
}

function buildFixture(
  historyPath: string,
  todayPath: string,
  at: string,
  messagesPath: string | undefined,
): RequestFixture {
  const now = parseDate('--at', at);
  const h = readJson<HistoryJson>('--history', historyPath);
  const t = readJson<TodayJson>('--today', todayPath);
  const started = parseDate('today.startedAt', t.startedAt);
  const last = t.lastActivityAt ? parseDate('today.lastActivityAt', t.lastActivityAt) : now;

  const historyRows: ExerciseHistory[] = (h.exercises ?? []).map(e => {
    const performances: ExerciseLastPerformance[] = e.performances.map(p => {
      const when = new Date(p.date.length === 10 ? `${p.date}T11:00:00.000Z` : p.date);
      return {
        exerciseId: e.id,
        completedAt: when,
        sessionExercise: sessionExercise(e.id, e.name, toSets(p.sets, when), 'completed'),
      };
    });
    return {
      exerciseId: e.id,
      exerciseName: e.name,
      plannedText: e.planned,
      performances,
      lastSkippedAt: e.lastSkippedAt ? new Date(e.lastSkippedAt) : null,
      loadsUsed: collectLoadsUsed(performances),
    };
  });

  const exercises: SessionExerciseWithDetails[] = (t.exercises ?? []).map(e =>
    sessionExercise(e.id, e.name, toSets(e.sets, now), e.status),
  );
  const session = sessionOf(started, last, t.plan ?? [], exercises);
  session.place = t.place ?? null;

  const msgs = messagesPath
    ? toMessages(readJson<MessageJson[]>('--messages', messagesPath))
    : { history: [], current: new HumanMessage({ content: '(no --messages: empty conversation)', id: 'cur' }) };
  const timezone = h.user?.timezone ?? 'UTC';
  return {
    name: `custom (--at ${now.toISOString()})`,
    now,
    timezone,
    user: { id: h.user?.id ?? 'u1', ...h.user, timezone },
    data: {
      session,
      history: historyRows,
      lastWorkout: h.lastWorkout
        ? { completedAt: new Date(h.lastWorkout.completedAt), exerciseNames: h.lastWorkout.exerciseNames }
        : null,
      warmupHabit: h.warmupHabit ?? null,
      reportedToday: factsOf(t.reportedToday, 500),
      coachReplied: t.coachReplied ?? msgs.history.some(m => m._getType() === 'ai'),
      profileFacts: factsOf(h.facts, 1),
    },
    history: msgs.history,
    current: msgs.current,
  };
}

// ------------------------------------------------------------------ CLI

interface Args {
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(['--history', '--today', '--at', '--messages']);
const BOOL_FLAGS = new Set(['--case07', '--plain', '--sizes-only']);

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (BOOL_FLAGS.has(a)) {
      flags.set(a, true);
    } else if (VALUE_FLAGS.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        throw new UsageError(`${a} needs a value`);
      }
      flags.set(a, v);
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${a}`);
    }
  }
  return { flags };
}

function pickFixture({ flags }: Args): RequestFixture {
  const real = ['--history', '--today', '--at'].filter(f => flags.has(f));
  if (real.length > 0) {
    if (real.length < 3 || flags.has('--case07') || flags.has('--plain')) {
      throw new UsageError('--history, --today and --at go together and exclude --case07 / --plain');
    }
    return buildFixture(
      flags.get('--history') as string,
      flags.get('--today') as string,
      flags.get('--at') as string,
      flags.get('--messages') as string | undefined,
    );
  }
  if (flags.has('--messages')) {
    throw new UsageError('--messages needs --history, --today and --at');
  }
  if (flags.has('--case07') && flags.has('--plain')) {
    throw new UsageError('--case07 and --plain exclude each other');
  }
  return flags.has('--case07') ? CASE07_FIXTURE() : PLAIN_FIXTURE();
}

async function main(): Promise<void> {
  let args: Args;
  let fx: RequestFixture;
  try {
    args = parseArgs(process.argv.slice(2));
    fx = pickFixture(args);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${e.message}\n\n${USAGE}`);
      process.exit(2);
    }
    throw e;
  }
  const req = await assembleTrainingRequest(fx);

  if (!args.flags.has('--sizes-only')) {
    for (const m of req.messages) {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2);
      console.log(`===== ${m._getType()} =====\n${text}\n`);
    }
  }
  const width = Math.max(...req.sections.map(s => s.name.length));
  console.log(`Fixture: ${fx.name}`);
  console.log(`${'section'.padEnd(width)}  ${'chars'.padStart(7)}  ${'est. tokens'.padStart(11)}`);
  for (const s of req.sections) {
    console.log(`${s.name.padEnd(width)}  ${String(s.chars).padStart(7)}  ${String(s.tokens).padStart(11)}`);
  }
  console.log(
    `${'TOTAL (text, no tools)'.padEnd(width)}  ${String(req.totalChars).padStart(7)}  ${String(req.totalTokens).padStart(11)}`,
  );
  console.log(`tool schemas (separate): ${req.toolSchemaChars} chars`);
}

void main();
