/**
 * AC-AT-2: a non-'ok' run carries its cause. `conversation_runs` stores the
 * error class and a truncated message for every failure path that reaches
 * the adapter's catch (both `isProviderError` branches — provider outage and
 * a plain bug); an 'ok' run leaves both null.
 *
 * Real production wiring (registerInfraServices), real graph, adapter,
 * repositories and PostgresSaver; only the ChatModel beneath the gateway is
 * replaced, by the shared scripted model (scripted-model.ts) — it answers a
 * scripted text, or throws once via `failNextChat`.
 */
import { eq } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { conversationRuns } from '@infra/db/schema';

import { runScenario } from '../../../evals/lib/run-scenario';
import type { Scenario } from '../../../evals/schema/scenario.schema';

import { buildAlexScenario } from './personas';
import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

const scenarioFor = (id: string, text: string): Scenario =>
  buildAlexScenario(id, 'AC-AT-2: one run that succeeds, one whose model call throws', text);

/** The user's most recent conversation_runs row. */
async function latestRunRow(userId: string) {
  const rows = await db.select().from(conversationRuns).where(eq(conversationRuns.userId, userId));
  return rows[rows.length - 1] ?? null;
}

describe('a non-ok run carries its cause (AC-AT-2)', () => {
  let model: ScriptedModelHandle;

  beforeAll(() => {
    model = installScriptedModel();
  });

  it('control: a run that completes leaves errorClass and errorMessage null', async () => {
    model.enqueueChat([{ text: 'Хорошо.' }]);
    let userId = '';
    const ok = await runScenario(scenarioFor('run-error-cause-ok', 'привет, начинаю тренировку'), {
      onSeeded: world => {
        ({ userId } = world);
      },
    });
    expect(ok.steps[0]!.delivered).toBe('Хорошо.');

    const runRow = await latestRunRow(userId);
    expect(runRow?.outcome).toBe('ok');
    expect(runRow?.errorClass).toBeNull();
    expect(runRow?.errorMessage).toBeNull();
  });

  it('a bug inside the graph records outcome core_error with the error class and message', async () => {
    let userId = '';
    model.failNextChat(new TypeError('simulated core bug'));
    await expect(
      runScenario(scenarioFor('run-error-cause-core', 'сделал подход'), {
        onSeeded: world => {
          ({ userId } = world);
        },
      }),
    ).rejects.toBeTruthy();

    const runRow = await latestRunRow(userId);
    expect(runRow?.outcome).toBe('core_error');
    expect(runRow?.errorClass).toBe('TypeError');
    expect(runRow?.errorMessage).toBe('simulated core bug');
  });

  it('a provider outage records outcome llm_unavailable with the error class and message', async () => {
    let userId = '';
    model.failNextChat(Object.assign(new Error('upstream unavailable'), { status: 503 }));
    await expect(
      runScenario(scenarioFor('run-error-cause-provider', 'еще один подход'), {
        onSeeded: world => {
          ({ userId } = world);
        },
      }),
    ).rejects.toBeTruthy();

    const runRow = await latestRunRow(userId);
    expect(runRow?.outcome).toBe('llm_unavailable');
    expect(runRow?.errorClass).toBe('Error');
    expect(runRow?.errorMessage).toBe('upstream unavailable');
  });
});
