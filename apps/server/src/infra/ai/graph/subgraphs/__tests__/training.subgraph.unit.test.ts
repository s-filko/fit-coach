/**
 * RED tests for ADR-0011 Phase 1: tool ordering and batch dedup.
 *
 * These tests import pure functions that will be extracted from sequentialToolNode.
 * Currently RED because the functions do not exist yet.
 *
 * WHY RED:
 *   sortToolCallsByPriority — not exported from training.subgraph.ts
 *   findDuplicateLogSets    — not exported from training.subgraph.ts
 *   → import error → all tests fail
 *
 * GREEN after: extracting sort + dedup logic into exported pure functions.
 */

import { sortToolCallsByPriority, findDuplicateLogSets } from '../training.subgraph';

interface ToolCallStub {
  name: string;
  args: Record<string, unknown>;
  id: string;
  type: 'tool_call';
}

const makeToolCall = (name: string, args: Record<string, unknown> = {}, id?: string): ToolCallStub => ({
  name,
  args,
  id: id ?? `call-${name}-${Date.now()}-${Math.random()}`,
  type: 'tool_call',
});

// ---------------------------------------------------------------------------
// Fix 1.1: Deterministic tool ordering
// ---------------------------------------------------------------------------

describe('sortToolCallsByPriority (ADR-0011 Fix 1.1)', () => {
  it('should sort log_set before complete_current_exercise in a mixed batch', () => {
    const calls = [
      makeToolCall('complete_current_exercise', {}, 'complete'),
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80, order: 1 }, 'set'),
    ];

    const sorted = sortToolCallsByPriority(calls);

    expect(sorted[0].name).toBe('log_set');
    expect(sorted[1].name).toBe('complete_current_exercise');
  });

  it('should sort finish_training after all other tools', () => {
    const calls = [
      makeToolCall('finish_training', {}, 'finish'),
      makeToolCall('complete_current_exercise', {}, 'complete'),
      makeToolCall('log_set', { exerciseId: 12, reps: 10, order: 1 }, 'set'),
    ];

    const sorted = sortToolCallsByPriority(calls);

    expect(sorted[0].name).toBe('log_set');
    expect(sorted[1].name).toBe('complete_current_exercise');
    expect(sorted[2].name).toBe('finish_training');
  });

  it('should sort correction tools after transitions but before finish', () => {
    const calls = [
      makeToolCall('finish_training', {}, 'finish'),
      makeToolCall('delete_last_sets', { exerciseId: 12, count: 1 }, 'del'),
      makeToolCall('complete_current_exercise', {}, 'complete'),
      makeToolCall('log_set', { exerciseId: 12, reps: 10, order: 1 }, 'set'),
    ];

    const sorted = sortToolCallsByPriority(calls);

    expect(sorted[0].name).toBe('log_set');
    expect(sorted[1].name).toBe('complete_current_exercise');
    expect(sorted[2].name).toBe('delete_last_sets');
    expect(sorted[3].name).toBe('finish_training');
  });

  it('should preserve order field within log_set calls', () => {
    const calls = [
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80, order: 3 }, 'set-3'),
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80, order: 1 }, 'set-1'),
      makeToolCall('log_set', { exerciseId: 12, reps: 8, weight: 85, order: 2 }, 'set-2'),
    ];

    const sorted = sortToolCallsByPriority(calls);

    expect(sorted.map((c: ToolCallStub) => c.id)).toEqual(['set-1', 'set-2', 'set-3']);
  });

  it('should handle log_set calls without order field (default to end)', () => {
    const calls = [
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80 }, 'no-order'),
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80, order: 1 }, 'has-order'),
    ];

    const sorted = sortToolCallsByPriority(calls);

    expect(sorted[0].id).toBe('has-order');
    expect(sorted[1].id).toBe('no-order');
  });
});

// ---------------------------------------------------------------------------
// Fix 1.2: Batch deduplication validation
// ---------------------------------------------------------------------------

describe('findDuplicateLogSets (ADR-0011 Fix 1.2)', () => {
  it('should detect duplicate log_set calls with identical args (no order)', () => {
    const calls = [
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80 }, 'a'),
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80 }, 'b'),
    ];

    const duplicateIds = findDuplicateLogSets(calls);

    expect(duplicateIds).toContain('a');
    expect(duplicateIds).toContain('b');
  });

  it('should return empty array when all log_set calls have different args', () => {
    const calls = [
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80 }, 'a'),
      makeToolCall('log_set', { exerciseId: 12, reps: 8, weight: 85 }, 'b'),
    ];

    const duplicateIds = findDuplicateLogSets(calls);

    expect(duplicateIds).toHaveLength(0);
  });

  it('should treat log_set calls with different order values as non-duplicates', () => {
    const calls = [
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80, order: 1 }, 'a'),
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80, order: 2 }, 'b'),
    ];

    const duplicateIds = findDuplicateLogSets(calls);

    expect(duplicateIds).toHaveLength(0);
  });

  it('should detect duplicates when both calls have same order value', () => {
    const calls = [
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80, order: 1 }, 'a'),
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80, order: 1 }, 'b'),
    ];

    const duplicateIds = findDuplicateLogSets(calls);

    expect(duplicateIds).toContain('a');
    expect(duplicateIds).toContain('b');
  });

  it('should only consider log_set calls, ignore other tool types', () => {
    const calls = [
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80 }, 'set-a'),
      makeToolCall('complete_current_exercise', {}, 'complete'),
    ];

    const duplicateIds = findDuplicateLogSets(calls);

    expect(duplicateIds).toHaveLength(0);
  });

  it('should return empty array for a single log_set call', () => {
    const calls = [makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80 }, 'only')];

    const duplicateIds = findDuplicateLogSets(calls);

    expect(duplicateIds).toHaveLength(0);
  });

  it('should detect triplicate log_set calls', () => {
    const calls = [
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80 }, 'a'),
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80 }, 'b'),
      makeToolCall('log_set', { exerciseId: 12, reps: 10, weight: 80 }, 'c'),
    ];

    const duplicateIds = findDuplicateLogSets(calls);

    expect(duplicateIds).toHaveLength(3);
    expect(duplicateIds).toContain('a');
    expect(duplicateIds).toContain('b');
    expect(duplicateIds).toContain('c');
  });
});
