import { compose } from '@infra/ai/prompts/compose';
import { PHASE_PROMPTS } from '@infra/ai/prompts/index';

/**
 * v9 (load-facts plan Task 2, D13, AC-LF-6): the current training prompt is v9 and differs
 * from v8 only in rule 1 (points to LOAD PLAN for the computed facts), the get_load_plan
 * TOOLS entry and RULE 11 (LOAD PLAN and get_load_plan among the sources of past data).
 * The block and the tool itself are Task 3 — only the prompt text mentions them here.
 */
function trainingPromptText(): string {
  const sections = PHASE_PROMPTS.training.current.render({
    now: new Date('2026-09-29T08:00:00Z'),
    timezone: 'Europe/Berlin',
    client: 'telegram',
    user: null,
    lastMessageTime: null,
  });
  return compose(sections);
}

describe('phase.training v9 — LOAD PLAN facts and get_load_plan (load-facts plan D13, AC-LF-6)', () => {
  it('the current training prompt is v10 (v9 + the CONTEXT LOCATION note — prompt-caching plan D2)', () => {
    expect(PHASE_PROMPTS.training.current.version).toBe('v10');
  });

  it('rule 1 points to LOAD PLAN for the computed facts and states it recommends no weight', () => {
    const prompt = trainingPromptText();
    const rule1 = /1\. <b>First set of each exercise<\/b>[^]*?(?=\n2\. )/.exec(prompt);
    expect(rule1).not.toBeNull();
    expect(rule1![0]).toContain(
      "LOAD PLAN lists computed facts for each of today's exercises — the reference performance with its date and fatigue context, working weight, e1RM trend, gaps and constraints. Quote them with their dates; LOAD PLAN recommends no weight — make your recommendation from these facts as below.",
    );
  });

  it('the TOOLS list has a get_load_plan entry after get_exercise_history', () => {
    const prompt = trainingPromptText();
    const toolsIdx = prompt.indexOf('=== TOOLS ===');
    const rulesIdx = prompt.indexOf('CRITICAL RULES');
    expect(toolsIdx).toBeGreaterThan(-1);
    const toolsBlock = prompt.slice(toolsIdx, rulesIdx > -1 ? rulesIdx : undefined);
    const historyIdx = toolsBlock.indexOf('<b>get_exercise_history</b>');
    const loadPlanIdx = toolsBlock.indexOf('<b>get_load_plan</b>');
    expect(historyIdx).toBeGreaterThan(-1);
    expect(loadPlanIdx).toBeGreaterThan(historyIdx);
    const entryMatch = /- <b>get_load_plan<\/b>[^\n]*/.exec(toolsBlock);
    expect(entryMatch).not.toBeNull();
    expect(entryMatch![0]).toContain("not in today's plan");
    expect(entryMatch![0]).toContain('"No completed record" is a normal answer');
  });

  it('RULE 11 lists LOAD PLAN and get_load_plan among the sources of past data', () => {
    const prompt = trainingPromptText();
    const rule11 = /RULE 11\.[^\n]*/.exec(prompt);
    expect(rule11).not.toBeNull();
    expect(rule11![0]).toContain(
      'EXERCISE HISTORY, RECENT WORKOUTS, LOAD PLAN, and get_exercise_history / get_load_plan results',
    );
  });
});
