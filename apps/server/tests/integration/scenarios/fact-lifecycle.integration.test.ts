/**
 * The fact-lifecycle journeys, deterministic layer (course-check plan Task 3 /
 * AC-FL-7): five multi-turn stories over the real test database with a
 * scripted model, each run TWICE — course check ON and OFF — so the owner can
 * compare the layer on the same journeys (the comparison itself is an
 * owner-launched live run, never part of a task).
 *
 * What makes these journeys and not unit tests: every ending is read from the
 * DATABASE (`user_facts` rows: status, archive reason, closure stamp, dates,
 * confirmations, links; `workout_plans`), through the SAME pure evaluators the
 * live L3 layer uses. The coach's prose proves nothing — the 2026-09-21 dev
 * smoke had the coach announcing a retraction that never happened.
 *
 * Both modes run every scenario module's own expectations; assertions that only
 * exist with the check on (the directive block) are tagged `courseCheckOnly` in
 * the scenario and skipped in the off run. Journey-specific tests below add
 * what a scenario cannot say: call counts of the check, what the check was
 * handed, and the shape of the chain.
 *
 * Six journeys are listed in the plan; (d)'s promotion to a pattern fact is NOT
 * implemented anywhere (owner ruling, worker ask 2026-09-21) — see its it.todo.
 */
import type { BaseMessage } from '@langchain/core/messages';

import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import { evaluateFactExpectations, evaluatePlanExpectations } from '../../../evals/lib/persisted-expectations';
import {
  assertionCourseCheckOnly,
  assertionText,
  ScenarioSchema,
  type Scenario,
} from '../../../evals/schema/scenario.schema';
import { scenario as journeyA, KNEE_FACT, NEW_PHASE } from '../../../evals/scenarios/fl-a-review-date.scenario';
import { scenario as journeyB, SHOULDER_FACT } from '../../../evals/scenarios/fl-b-closed-not-resurrected.scenario';
import {
  scenario as journeyC,
  DOMS_FACT,
  EXPIRY_QUESTION,
  SHOULDER_TWEAK,
  STALE_ANKLE,
} from '../../../evals/scenarios/fl-c-short-states.scenario';
import { scenario as journeyD, RECURRING_FACT } from '../../../evals/scenarios/fl-d-recurring-short-state.scenario';
import { scenario as journeyE } from '../../../evals/scenarios/fl-e-advisory-plan.scenario';
import {
  scenario as journeyF,
  EQUIPMENT_FACT,
  KNEE_NEW,
  KNEE_OLD,
  SLEEP_FACT,
} from '../../../evals/scenarios/fl-f-remembered-corrected-deleted.scenario';

import { resolveFactPlaceholders } from './fact-placeholders';
import { installScriptedModel, type ScriptedModelHandle, type StructuredInput } from './scripted-model';

/**
 * The mark the check's input puts on a fact whose review date has arrived. The bare words "REVIEW DUE"
 * also appear in the check's own instructions, so the per-fact mark is what identifies a due fact.
 */
const REVIEW_DUE_MARK = '[REVIEW DUE — ask about it now]';

/** The journeys' relative dates ('-20d', '+3d') resolve against this T0. */
const T0 = new Date('2026-09-21T10:00:00.000Z');

/** jest's `FakeableAPI` minus 'Date' — the union itself is not exported by @types/jest. */
type RealTimerApi =
  | 'setTimeout'
  | 'clearTimeout'
  | 'setInterval'
  | 'clearInterval'
  | 'setImmediate'
  | 'clearImmediate'
  | 'nextTick'
  | 'queueMicrotask'
  | 'performance'
  | 'hrtime'
  | 'requestAnimationFrame'
  | 'cancelAnimationFrame'
  | 'requestIdleCallback'
  | 'cancelIdleCallback';

/** Timer APIs that must stay REAL — pg, PostgresSaver and the ONNX embedding pipeline schedule work through them. */
const REAL_TIMER_APIS: RealTimerApi[] = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'nextTick',
  'queueMicrotask',
  'performance',
  'hrtime',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
];

type Mode = 'on' | 'off';
const MODES: Mode[] = ['on', 'off'];

interface Journey {
  scenario: Scenario;
  /** Environment for the run's wiring — journey (b) needs compaction to fire on a two-turn episode. */
  env?: Record<string, string>;
}

const JOURNEYS: Journey[] = [
  { scenario: journeyA },
  {
    scenario: journeyB,
    // keepTurns 0 / minTurns 0 / minTokens 0: the whole short episode is summarised at the gap (same knobs as user-facts.scenario.unit.test).
    env: { EPISODE_KEEP_TURNS: '0', EPISODE_MIN_TURNS: '0', EPISODE_MIN_TOKENS: '0' },
  },
  { scenario: journeyC },
  { scenario: journeyD },
  { scenario: journeyE },
  { scenario: journeyF },
];

/** What one step made observable beyond the runner's own plane. */
interface StepRecord {
  /** Every chat-model input of the step (one entry per model call). */
  chat: BaseMessage[][];
  /** The same, flattened to text. */
  chatText: string;
  /** Structured requests of the step: the course check's and the summariser's inputs. */
  structured: StructuredInput[];
  /** A scripted chat answer that no model call consumed. */
  chatScriptLeftover: boolean;
}

interface JourneyRun {
  result: ScenarioRunResult;
  steps: StepRecord[];
}

/** Duck-typed (_getType, not instanceof): jest.resetModules re-evaluates @langchain/core. */
function typeOf(m: BaseMessage | undefined): string {
  return (m as { _getType?: () => string } | undefined)?._getType?.() ?? '';
}

function textOf(m: BaseMessage | undefined): string {
  const content = m?.content;
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
}

const flatten = (calls: BaseMessage[][]): string =>
  calls
    .flat()
    .map(m => textOf(m))
    .join('\n');

let model: ScriptedModelHandle;
const runs = new Map<string, JourneyRun>();
const runKey = (scenario: Scenario, mode: Mode): string => `${scenario.id}:${mode}`;
const runOf = (scenario: Scenario, mode: Mode): JourneyRun => runs.get(runKey(scenario, mode))!;

async function runJourney(journey: Journey, mode: Mode): Promise<JourneyRun> {
  const { scenario, env = {} } = journey;
  const previousEnv = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  model.reset();
  jest.setSystemTime(T0);

  let userId = '';
  model.setPlaceholderResolver(text => resolveFactPlaceholders(text, userId));
  const steps: StepRecord[] = [];
  try {
    const result = await runScenario(scenario, {
      courseCheck: mode,
      onAdvance: now => jest.setSystemTime(now),
      onSeeded: world => {
        userId = world.userId;
      },
      onStepStart: index => {
        // Scripts are queued per step, so nothing a step leaves unused can leak into the next.
        model.clearStructuredScripts();
        model.drainChatInputs();
        model.drainStructuredInputs();
        const step = scenario.steps[index]!;
        if (step.action !== 'user') {
          return;
        }
        model.enqueueChat(step.script ?? []);
        if (step.structured?.courseCheck) {
          model.enqueueCourseDirectives([JSON.stringify(step.structured.courseCheck)]);
        }
        if (step.structured?.summary) {
          model.enqueueStructuredAnswers([JSON.stringify(step.structured.summary)]);
        }
      },
      onStep: () => {
        const chat = model.drainChatInputs();
        steps.push({
          chat,
          chatText: flatten(chat),
          structured: model.drainStructuredInputs(),
          chatScriptLeftover: !model.chatScriptExhausted,
        });
      },
    });
    return { result, steps };
  } finally {
    model.setPlaceholderResolver(null);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

beforeAll(async () => {
  for (const { scenario } of JOURNEYS) {
    expect(ScenarioSchema.parse(scenario)).toBeTruthy(); // every journey is format-valid
  }
  model = installScriptedModel();
  jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
  jest.setSystemTime(T0);
  for (const journey of JOURNEYS) {
    for (const mode of MODES) {
      runs.set(runKey(journey.scenario, mode), await runJourney(journey, mode));
    }
  }
}, 600_000);

afterAll(() => {
  jest.useRealTimers();
});

/** The course-check requests of one step (the summariser's are the other kind). */
const courseChecks = (rec: StepRecord): StructuredInput[] => rec.structured.filter(s => s.kind === 'course_check');
const summaries = (rec: StepRecord): StructuredInput[] => rec.structured.filter(s => s.kind === 'summary');
const inputText = (input: StructuredInput): string => input.messages.map(m => textOf(m)).join('\n');

// --- the generic plane: every step of every journey, both modes ---

describe.each(JOURNEYS.flatMap(j => MODES.map(mode => ({ scenario: j.scenario, mode }))))(
  '$scenario.id — course check $mode',
  ({ scenario, mode }) => {
    it.each(scenario.steps.map((step, index) => ({ index, step })))(
      'step $index ($step.action) meets its expectations',
      ({ index, step }) => {
        const run = runOf(scenario, mode);
        const obs = run.result.steps[index]!;
        const rec = run.steps[index]!;
        const expect_ = step.expect ?? {};
        const failures: string[] = [];
        const check = (name: string, passed: boolean, detail = ''): void => {
          if (!passed) {
            failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
          }
        };

        if (step.action === 'user') {
          check('run outcome ok', obs.runRow?.outcome === 'ok', `outcome ${obs.runRow?.outcome ?? 'no row'}`);
          check('script fully consumed', !rec.chatScriptLeftover, 'a scripted chat answer was never asked for');
        }

        const called = obs.runRow?.toolCalls?.map(c => c.name) ?? [];
        for (const entry of expect_.tools?.must ?? []) {
          check(
            `tools.must ${assertionText(entry)}`,
            called.includes(assertionText(entry)),
            `called: ${called.join(', ')}`,
          );
        }
        for (const entry of expect_.tools?.mustNot ?? []) {
          check(`tools.mustNot ${assertionText(entry)}`, !called.includes(assertionText(entry)));
        }
        for (const entry of expect_.delivered?.mustMatch ?? []) {
          check(`delivered contains "${assertionText(entry)}"`, obs.delivered.includes(assertionText(entry)));
        }
        for (const entry of expect_.delivered?.mustNotMatch ?? []) {
          check(`delivered lacks "${assertionText(entry)}"`, !obs.delivered.includes(assertionText(entry)));
        }
        if (expect_.phaseAfter) {
          check(
            'phaseAfter',
            obs.phase === expect_.phaseAfter.phase,
            `expected ${expect_.phaseAfter.phase}, got ${obs.phase}`,
          );
        }

        // seen — the course-check-only entries do not exist in the off run.
        const applicable = (entries: NonNullable<typeof expect_.seen>['mustMatch']): string[] =>
          (entries ?? []).filter(e => mode === 'on' || !assertionCourseCheckOnly(e)).map(assertionText);
        for (const text of applicable(expect_.seen?.mustMatch)) {
          check(`model input contains "${text}"`, rec.chatText.includes(text));
        }
        for (const text of applicable(expect_.seen?.mustNotMatch)) {
          check(`model input lacks "${text}"`, !rec.chatText.includes(text));
        }

        // persisted — the database plane, through the evaluators L3 shares.
        for (const c of [
          ...evaluateFactExpectations(
            obs.facts,
            expect_.persisted?.facts,
            expect_.persisted?.factsAbsent,
            run.result.t0,
          ),
          ...evaluatePlanExpectations(obs.plans, expect_.persisted?.plans),
        ]) {
          check(c.check, c.passed, c.detail);
        }

        expect(failures).toEqual([]);
      },
    );

    if (mode === 'off') {
      it('the layer is really off: no course-check call and no directive block anywhere in the journey', () => {
        const run = runOf(scenario, 'off');
        expect(run.steps.flatMap(courseChecks)).toEqual([]);
        expect(run.steps.every(rec => !rec.chatText.includes('## Course Directive'))).toBe(true);
      });
    } else {
      it('cost discipline: the check is at most ONE call per step', () => {
        for (const rec of runOf(scenario, 'on').steps) {
          expect(courseChecks(rec).length).toBeLessThanOrEqual(1);
        }
      });
    }
  },
);

// --- journey-specific: what a scenario cannot say about itself ---

describe('journey (a) — a long-term injury whose review date arrives', () => {
  const on = (): JourneyRun => runOf(journeyA, 'on');

  it('the check fires on entry, is silent on the answer turn, and refires when the fact moves (1, 0, 1 calls)', () => {
    expect(on().steps.map(rec => courseChecks(rec).length)).toEqual([1, 0, 1]);
  });

  it('the first check is handed the knee fact as REVIEW DUE — the question has a specific reason', () => {
    const [input] = courseChecks(on().steps[0]!);
    expect(inputText(input!)).toContain(KNEE_FACT);
    expect(inputText(input!)).toContain(REVIEW_DUE_MARK);
  });

  it('after the answer the date has moved: the next check sees the new phase and no REVIEW DUE', () => {
    const [input] = courseChecks(on().steps[2]!);
    expect(inputText(input!)).toContain(NEW_PHASE);
    expect(inputText(input!)).not.toContain(REVIEW_DUE_MARK);
  });

  it('with the check off the fact is still in the prompt and the database ending is the same', () => {
    const off = runOf(journeyA, 'off');
    expect(off.steps[0]!.chatText).toContain(KNEE_FACT);
    const last = off.result.steps[2]!.facts.find(f => f.fact.includes('Left knee'))!;
    expect(last.phaseNote).toBe(NEW_PHASE);
  });
});

describe('journey (b) — "it\'s fine now" is never undone by older evidence', () => {
  it.each(MODES)('[%s] the older episode WAS compacted, so the resurrection attempt really happened', mode => {
    const rec = runOf(journeyB, mode).steps[2]!;
    expect(summaries(rec)).toHaveLength(1);
  });

  it('[on] after the closure the course check is never handed the shoulder fact again', () => {
    const run = runOf(journeyB, 'on');
    const afterClosure = run.steps.slice(1).flatMap(courseChecks);
    expect(afterClosure.length).toBeGreaterThan(0); // the check did run — it just has nothing to say about the shoulder
    for (const input of afterClosure) {
      expect(inputText(input)).not.toContain(SHOULDER_FACT);
    }
    // …whereas before the closure it saw the fact (the fact was live).
    expect(inputText(courseChecks(run.steps[0]!)[0]!)).toContain(SHOULDER_FACT);
  });

  it.each(MODES)('[%s] the three attempts are refused at the source: no row was added, none re-activated', mode => {
    const rows = runOf(journeyB, mode).result.steps[2]!.facts.filter(f => f.fact.includes('Right shoulder'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'archived',
      archivedReason: 'user_closed',
      confirmations: 1,
      supersedesId: null,
    });
  });
});

describe('journey (c) — a short state that expires silently versus one that asks once', () => {
  it('[on] before the expiry the check is handed BOTH facts, and only the tweak carries ask_once', () => {
    const [input] = courseChecks(runOf(journeyC, 'on').steps[0]!);
    const text = inputText(input!);
    expect(text).toContain(DOMS_FACT);
    expect(text).toContain(SHOULDER_TWEAK);
    expect(text.match(/, ask_once/g)).toHaveLength(1);
    const tweakLine = text.split('\n').find(l => l.includes(SHOULDER_TWEAK))!;
    expect(tweakLine).toContain('ask_once');
    expect(text.split('\n').find(l => l.includes(DOMS_FACT))!).not.toContain('ask_once');
  });

  it('[on] after the expiry the check refires once: the forget fact is NOT in its input, the ask_once fact is — marked for ONE question', () => {
    const inputs = courseChecks(runOf(journeyC, 'on').steps[2]!);
    expect(inputs).toHaveLength(1);
    const text = inputText(inputs[0]!);
    expect(text).not.toContain(DOMS_FACT); // silently archived: not even a prompt line
    expect(text).toContain(`${SHOULDER_TWEAK} (physical_constraint, expired 1 day(s) ago)`);
  });

  it('[on] it is asked exactly once: the next turn makes no course-check call and nothing is due', () => {
    const run = runOf(journeyC, 'on');
    expect(courseChecks(run.steps[3]!)).toHaveLength(0);
    expect(run.steps[3]!.chatText).not.toContain(SHOULDER_TWEAK);
  });

  it('[on] ONE-SHOT: the question is rendered in the run that asked and in NO later run, while the directive block itself persists', () => {
    const run = runOf(journeyC, 'on');
    expect(run.steps[2]!.chatText).toContain(EXPIRY_QUESTION);
    expect(run.steps[3]!.chatText).not.toContain(EXPIRY_QUESTION);
    expect(run.steps[3]!.chatText).toContain('## Course Directive'); // the stored directive still rides — without the question
  });

  it.each(MODES)(
    '[%s] a fact expired far beyond the staleness bound is archived silently at the first run and never asked',
    mode => {
      const run = runOf(journeyC, mode);
      expect(run.result.steps[0]!.facts.find(f => f.fact === STALE_ANKLE)).toMatchObject({
        status: 'archived',
        archivedReason: 'expired',
        closedByUserAt: null,
      });
      for (const rec of run.steps) {
        expect(rec.chatText).not.toContain(STALE_ANKLE);
        expect(rec.structured.map(inputText).join('\n')).not.toContain(STALE_ANKLE);
      }
    },
  );

  it('[on] the tweak was archived AFTER the question was put — the directive that carries it is what the model saw', () => {
    const run = runOf(journeyC, 'on');
    expect(run.steps[2]!.chatText).toContain('did the left shoulder tweak leave any trace?');
    expect(run.result.steps[2]!.facts.find(f => f.fact === SHOULDER_TWEAK)).toMatchObject({
      status: 'archived',
      archivedReason: 'expired',
    });
  });

  it('[off] nobody asks, but expiry is still performed: both facts are archived as expired, the same ending in the database', () => {
    const run = runOf(journeyC, 'off');
    expect(run.steps.flatMap(courseChecks)).toEqual([]);
    const rows = run.result.steps[2]!.facts;
    expect(rows.map(f => [f.fact, f.status, f.archivedReason])).toEqual(
      expect.arrayContaining([
        [DOMS_FACT, 'archived', 'expired'],
        [SHOULDER_TWEAK, 'archived', 'expired'],
      ]),
    );
  });
});

describe('journey (d) — the same short state recurring three times', () => {
  it.each(MODES)(
    '[%s] leaves a three-row supersedes_id chain: two archived rows and one active, linked in order',
    mode => {
      const steps = runOf(journeyD, mode).result.steps;
      const rows = steps[steps.length - 1]!.facts.filter(f => f.fact === RECURRING_FACT);
      expect(rows).toHaveLength(3);
      const active = rows.filter(r => r.status === 'active');
      const archived = rows.filter(r => r.status === 'archived');
      expect(active).toHaveLength(1);
      expect(archived).toHaveLength(2);
      // active → second closed row → first closed row → nothing: each return replaces the closure before it.
      const second = rows.find(r => r.id === active[0]!.supersedesId)!;
      expect(second).toBeDefined();
      const first = rows.find(r => r.id === second.supersedesId)!;
      expect(first).toBeDefined();
      expect(first.supersedesId).toBeNull();
      expect([first, second].every(r => r.archivedReason === 'user_closed' && r.closedByUserAt !== null)).toBe(true);
    },
  );

  // WHY THIS STOPS AT THE CHAIN: the promotion of a recurring short state to a physiological_pattern
  // fact is not implemented anywhere, and it is not part of this plan (owner ruling, 2026-09-21 — the
  // worker's ask). Its design is open: who promotes (code at the Nth occurrence, or a course-check
  // directive line via manage_fact), what counts as the same state (factKey is normalised text; category +
  // muscleGroup is coarse; model-judged identity costs a call), and the threshold/window. Scripting the
  // coach to write the pattern fact would make the test author the ending, not the code.
  it.todo('the third occurrence is promoted to a physiological_pattern fact (not implemented — see the comment above)');
});

describe('journey (e) — a plan that hits non-permanent constraints is saved, with an advisory', () => {
  it.each(MODES)('[%s] the save was an ok outcome, not a rejection, and the plan row exists', mode => {
    const run = runOf(journeyE, mode);
    const saveCall = run.result.steps[1]!.runRow!.toolCalls!.find(c => c.name === 'save_workout_plan');
    expect(saveCall).toMatchObject({ outcomeKind: 'ok' });
    expect(run.result.steps[1]!.plans).toHaveLength(1);
  });

  it.each(MODES)('[%s] the advisory reached the model in the SAME run as the save', mode => {
    const rec = runOf(journeyE, mode).steps[1]!;
    const toolMessages = rec.chat.flat().filter(m => typeOf(m) === 'tool');
    const advisory = toolMessages.map(m => textOf(m)).find(t => t.includes('ADVISORY'));
    expect(advisory).toBeDefined();
    expect(advisory).toContain('Plan saved');
  });
});

describe('journey (f) — what is remembered, then one fact corrected and one deleted', () => {
  /** The content of the LAST list_facts result the model was handed in a step. */
  function lastListing(mode: Mode, stepIndex: number): string {
    const tools = runOf(journeyF, mode)
      .steps[stepIndex]!.chat.flat()
      .filter(m => typeOf(m) === 'tool');
    return textOf(tools[tools.length - 1]);
  }

  it.each(MODES)('[%s] the first listing shows all three facts', mode => {
    const listing = lastListing(mode, 0);
    expect(listing).toContain(EQUIPMENT_FACT);
    expect(listing).toContain(KNEE_OLD);
    expect(listing).toContain(SLEEP_FACT);
  });

  it.each(MODES)('[%s] the next listing reflects the correction and the deletion', mode => {
    const listing = lastListing(mode, 2);
    expect(listing).toContain(KNEE_NEW);
    expect(listing).toContain(EQUIPMENT_FACT);
    expect(listing).not.toContain(KNEE_OLD);
    expect(listing).not.toContain(SLEEP_FACT);
  });

  it.each(MODES)(
    '[%s] the correction kept the row (same id); the deletion ARCHIVED its row — nothing was removed',
    mode => {
      const first = runOf(journeyF, mode).result.steps[0]!.facts;
      const after = runOf(journeyF, mode).result.steps[2]!.facts;
      expect(after.find(f => f.fact === KNEE_NEW)!.id).toBe(first.find(f => f.fact === KNEE_OLD)!.id);
      // Same number of rows before and after: the "deleted" fact is still there, under its own reason.
      expect(after).toHaveLength(first.length);
      expect(after.find(f => f.fact === SLEEP_FACT)).toMatchObject({
        id: first.find(f => f.fact === SLEEP_FACT)!.id,
        status: 'archived',
        archivedReason: 'user_deleted',
      });
    },
  );

  it.each(MODES)('[%s] the deleted fact does not surface even in the listing that asks for archived facts', mode => {
    expect(lastListing(mode, 2)).not.toContain(SLEEP_FACT);
  });
});
