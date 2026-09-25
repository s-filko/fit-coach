import { describe, expect, it } from '@jest/globals';

import { formatScenarioTranscript, summarizeChecks, type CheckResult, type ScenarioTranscript } from '../reporter';

function fabrication(): ScenarioTranscript {
  return {
    scenarioId: 'smoke',
    steps: [
      { action: 'user', text: 'привет, хочу потренироваться' },
      { action: 'advance' },
      { action: 'user', text: 'всё, закончил' },
    ],
    observations: [
      {
        action: 'user',
        delivered: 'Привет! Начнём с верха?\nКакой режим?',
        runRow: { toolCalls: [{ name: 'start_training_session' }] },
        phase: 'training',
      },
      { action: 'advance', delivered: '', runRow: null, phase: 'training' },
      {
        action: 'user',
        delivered: 'Молодец! Тренировка завершена.',
        runRow: { toolCalls: [{ name: 'log_set' }, { name: 'finish_training' }] },
        phase: 'chat',
      },
    ],
    checks: [
      { case: 'smoke::step 0', check: 'tools.must:start_training_session', passed: true },
      { case: 'smoke::step 0', check: 'phaseAfter', passed: false, detail: 'expected training, got chat' },
      { case: 'smoke::step 2', check: 'tools.must:finish_training', passed: true },
      {
        case: 'smoke::step 2',
        check: 'delivered.mustNotMatch:"вторник"',
        passed: false,
        knownBug: 'BUG-031',
        detail: 'delivered text contains "вторник"',
      },
    ],
  };
}

describe('formatScenarioTranscript (AC-SM-2)', () => {
  it('renders a user step: user text, delivered coach reply, tools, phase', () => {
    const text = formatScenarioTranscript(fabrication());
    expect(text).toContain('#0 user: привет, хочу потренироваться');
    expect(text).toContain('coach: Привет! Начнём с верха?');
    // multi-line delivered text: continuation lines align under the first
    expect(text).toContain('       Какой режим?');
    expect(text).toContain('tools: start_training_session');
    expect(text).toContain('phase: training');
  });

  it('lists several tool calls comma-separated on one line', () => {
    const text = formatScenarioTranscript(fabrication());
    expect(text).toContain('tools: log_set, finish_training');
  });

  it('renders an advance step without coach/tools lines', () => {
    const text = formatScenarioTranscript(fabrication());
    expect(text).toContain('#1 (advance)');
    expect(text).toContain('phase: training');
    const advanceBlock = text.split('#1 (advance)')[1]?.split('#2')[0] ?? '';
    expect(advanceBlock).not.toContain('coach:');
    expect(advanceBlock).not.toContain('tools:');
  });

  it('renders pass/fail/known-bug check lines under their step with failure detail', () => {
    const text = formatScenarioTranscript(fabrication());
    expect(text).toContain('  ✓ tools.must:start_training_session');
    expect(text).toContain('  ✗ phaseAfter — expected training, got chat');
    expect(text).toContain(
      '  ✗ delivered.mustNotMatch:"вторник" — delivered text contains "вторник" [known bug BUG-031]',
    );
    // each check line sits under its own step, not lumped at the end
    const step0Block = text.split('#0 user:')[1]?.split('#1 (advance)')[0] ?? '';
    expect(step0Block).toContain('✓ tools.must:start_training_session');
    expect(step0Block).toContain('✗ phaseAfter');
  });

  it('closes with the passed/failed/known-bug summary line', () => {
    const text = formatScenarioTranscript(fabrication());
    expect(text).toContain('passed 2 / failed 1 / known-bug 1');
  });

  it('keeps checks whose case carries no step suffix under a trailing section', () => {
    const transcript = fabrication();
    transcript.checks.push({ case: 'smoke', check: 'observed', passed: false, detail: 'no observation' });
    const text = formatScenarioTranscript(transcript);
    expect(text).toContain('checks without a step:');
    expect(text).toContain('  ✗ observed — no observation');
    expect(text).toContain('passed 2 / failed 2 / known-bug 1');
  });

  it('groups multi-sample runs (case ids with a sample label) under the same step', () => {
    const transcript = fabrication();
    transcript.checks.push({ case: 'smoke[2]::step 0', check: 'phaseAfter', passed: true });
    const text = formatScenarioTranscript(transcript);
    const step0Block = text.split('#0 user:')[1]?.split('#1 (advance)')[0] ?? '';
    expect(step0Block).toContain('✓ phaseAfter');
  });

  it('renders a step with no observation yet (only the user line, no phase)', () => {
    const transcript = fabrication();
    transcript.steps = [...transcript.steps, { action: 'user', text: 'что я делал на этой неделе?' }];
    const text = formatScenarioTranscript(transcript);
    const lastBlock = text.split('#3 user:')[1] ?? '';
    expect(lastBlock).toContain('что я делал на этой неделе?');
    expect(lastBlock).not.toContain('coach:');
  });
});

describe('summarizeChecks', () => {
  it('keeps known-bug reproductions out of both passed and failed', () => {
    const checks: CheckResult[] = [
      { case: 'c', check: 'a', passed: true },
      { case: 'c', check: 'b', passed: false },
      { case: 'c', check: 'd', passed: true, knownBug: 'BUG-001' },
      { case: 'c', check: 'e', passed: false, knownBug: 'BUG-002' },
    ];
    expect(summarizeChecks(checks)).toEqual({ passed: 1, failed: 1, known: 2 });
    expect(summarizeChecks([])).toEqual({ passed: 0, failed: 0, known: 0 });
  });
});
