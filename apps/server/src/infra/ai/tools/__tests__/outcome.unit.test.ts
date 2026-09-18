import { ToolMessage } from '@langchain/core/messages';

import { llmError, ok, systemError, userError } from '@domain/conversation/tool-outcome';

import { LLM_ERROR_PREFIX, outcomeKindOf, SYSTEM_ERROR_PREFIX, toToolMessage } from '../outcome';

describe('toToolMessage (serialisation v1, refactor-p3-tool-executor Task 3)', () => {
  it('renders ok as the summary verbatim with success status', () => {
    const msg = toToolMessage(ok('Set logged: 80kg × 8'), 'call-1');
    expect(msg.content).toBe('Set logged: 80kg × 8');
    expect(msg.status).toBe('success');
    expect(msg.tool_call_id).toBe('call-1');
  });

  it('renders user_error as the message verbatim (plus hint) with success status', () => {
    expect(toToolMessage(userError('Cannot complete registration — still missing: age'), 'c').content).toBe(
      'Cannot complete registration — still missing: age',
    );
    expect(toToolMessage(userError('No valid fields to save', 'Try naming one field'), 'c').content).toBe(
      'No valid fields to save Try naming one field',
    );
    expect(toToolMessage(userError('x'), 'c').status).toBe('success');
  });

  it('renders llm_error with the LLM_ERROR prefix and error status', () => {
    expect(toToolMessage(llmError('Invalid set data'), 'c').content).toBe('LLM_ERROR: Invalid set data');
    expect(toToolMessage(llmError('Invalid set data'), 'c').status).toBe('error');
    expect(toToolMessage(llmError('Bad id', 'Use search_exercises'), 'c').content).toBe(
      'LLM_ERROR: Bad id Use search_exercises',
    );
  });

  it('renders system_error with the SYSTEM_ERROR prefix and error status', () => {
    expect(toToolMessage(systemError('DB unavailable'), 'c').content).toBe('SYSTEM_ERROR: DB unavailable');
    expect(toToolMessage(systemError('DB unavailable'), 'c').status).toBe('error');
  });

  it('keeps the prefixes byte-identical to the training tools they move from', () => {
    expect(LLM_ERROR_PREFIX).toBe('LLM_ERROR:');
    expect(SYSTEM_ERROR_PREFIX).toBe('SYSTEM_ERROR:');
  });
});

describe('outcomeKindOf', () => {
  it('round-trips llm_error and system_error by prefix/status', () => {
    expect(outcomeKindOf(toToolMessage(llmError('x'), 'c'))).toBe('llm_error');
    expect(outcomeKindOf(toToolMessage(systemError('x'), 'c'))).toBe('system_error');
  });

  it('classifies ok and user_error as ok — a relayed refusal is not an error for the budget', () => {
    expect(outcomeKindOf(toToolMessage(ok('x'), 'c'))).toBe('ok');
    expect(outcomeKindOf(toToolMessage(userError('x'), 'c'))).toBe('ok');
  });

  it('classifies a legacy error-status ToolMessage without prefixes as llm_error', () => {
    expect(
      outcomeKindOf(new ToolMessage({ tool_call_id: 'c', content: 'Zod validation failed', status: 'error' })),
    ).toBe('llm_error');
  });
});
