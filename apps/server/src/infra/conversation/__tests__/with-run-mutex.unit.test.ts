import { type ConversationRunPort, type RunInput, type RunResult, ThreadBusyError } from '@domain/conversation/ports';

import { withRunMutex } from '@infra/conversation/with-run-mutex';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('withRunMutex (D-A, D-12, AC-1351)', () => {
  it('D-A: delegates run/clearContext through the mutex for a single caller', async () => {
    const run = jest.fn<Promise<RunResult>, [RunInput]>().mockResolvedValue({
      text: 'hi',
      phase: 'chat',
      runId: 'r1',
    });
    const clearContext = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const inner: ConversationRunPort = { run, clearContext, compact: jest.fn() };

    const decorated = withRunMutex(inner, { waitMs: 1000 });

    const result = await decorated.run({ userId: 'u1', text: 'hello' });
    expect(result).toEqual({ text: 'hi', phase: 'chat', runId: 'r1' });
    expect(run).toHaveBeenCalledWith({ userId: 'u1', text: 'hello' });

    await decorated.clearContext('u1');
    expect(clearContext).toHaveBeenCalledWith('u1');
  });

  it('AC-1351/D-12: same userId serialises — the second run starts only after the first settles', async () => {
    const starts: number[] = [];
    const ends: number[] = [];
    const gate = deferred<void>();

    const run = jest.fn<Promise<RunResult>, [RunInput]>().mockImplementation(async input => {
      starts.push(Date.now());
      if (input.text === 'first') {
        await gate.promise;
      }
      ends.push(Date.now());
      return { text: input.text, phase: 'chat', runId: input.text };
    });
    const inner: ConversationRunPort = { run, clearContext: jest.fn(), compact: jest.fn() };
    const decorated = withRunMutex(inner, { waitMs: 1000 });

    const first = decorated.run({ userId: 'u1', text: 'first' });
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = decorated.run({ userId: 'u1', text: 'second' });

    gate.resolve();
    await Promise.all([first, second]);

    expect(starts).toHaveLength(2);
    expect(starts[1]).toBeGreaterThanOrEqual(ends[0]);
  });

  it('AC-1351/D-12: different userIds do not serialise — both runs are entered concurrently', async () => {
    const entered: string[] = [];
    const gate = deferred<void>();

    const run = jest.fn<Promise<RunResult>, [RunInput]>().mockImplementation(async input => {
      entered.push(input.userId);
      if (input.userId === 'u1') {
        await gate.promise;
      }
      return { text: 'ok', phase: 'chat', runId: input.userId };
    });
    const inner: ConversationRunPort = { run, clearContext: jest.fn(), compact: jest.fn() };
    const decorated = withRunMutex(inner, { waitMs: 1000 });

    const first = decorated.run({ userId: 'u1', text: 'a' });
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = decorated.run({ userId: 'u2', text: 'b' });

    await second;
    expect(entered).toEqual(['u1', 'u2']);

    gate.resolve();
    await first;
  });

  it('D-D: a ThreadBusyError propagates unchanged and the inner run is never invoked for the rejected caller', async () => {
    const gate = deferred<void>();
    const run = jest.fn<Promise<RunResult>, [RunInput]>().mockImplementation(async input => {
      if (input.text === 'first') {
        await gate.promise;
      }
      return { text: input.text, phase: 'chat', runId: input.text };
    });
    const inner: ConversationRunPort = { run, clearContext: jest.fn(), compact: jest.fn() };
    const decorated = withRunMutex(inner, { waitMs: 20 });

    const first = decorated.run({ userId: 'u1', text: 'first' });
    const second = decorated.run({ userId: 'u1', text: 'second' });

    await expect(second).rejects.toThrow(ThreadBusyError);
    // Only the first call's invocation of `run` happened; the rejected
    // waiter's `fn` (the second `run` call) must never execute.
    expect(run).toHaveBeenCalledTimes(1);

    gate.resolve();
    await first;
  });

  it('D-D: no run row is written for a request rejected by the mutex (recordRun never called)', async () => {
    const recordRun = jest.fn().mockResolvedValue(undefined);
    const gate = deferred<void>();

    // Simulate the adapter's own responsibility for calling recordRun —
    // withRunMutex itself never touches a run service; this proves a
    // rejected waiter's `run` (and therefore any recordRun inside it) is
    // never invoked.
    const run = jest.fn<Promise<RunResult>, [RunInput]>().mockImplementation(async input => {
      if (input.text === 'first') {
        await gate.promise;
      }
      await recordRun();
      return { text: input.text, phase: 'chat', runId: input.text };
    });
    const inner: ConversationRunPort = { run, clearContext: jest.fn(), compact: jest.fn() };
    const decorated = withRunMutex(inner, { waitMs: 20 });

    const first = decorated.run({ userId: 'u1', text: 'first' });
    const second = decorated.run({ userId: 'u1', text: 'second' });

    await expect(second).rejects.toThrow(ThreadBusyError);
    expect(recordRun).not.toHaveBeenCalled();

    gate.resolve();
    await first;
    expect(recordRun).toHaveBeenCalledTimes(1);
  });

  it('D-A: clearContext is wrapped by the same mutex key as run — it must not race a run on the same userId', async () => {
    const order: string[] = [];
    const gate = deferred<void>();

    const run = jest.fn<Promise<RunResult>, [RunInput]>().mockImplementation(async () => {
      order.push('run-start');
      await gate.promise;
      order.push('run-end');
      return { text: 'ok', phase: 'chat', runId: 'r' };
    });
    const clearContext = jest.fn<Promise<void>, [string]>().mockImplementation(async () => {
      order.push('clear');
    });
    const inner: ConversationRunPort = { run, clearContext, compact: jest.fn() };
    const decorated = withRunMutex(inner, { waitMs: 1000 });

    const runPromise = decorated.run({ userId: 'u1', text: 'x' });
    await new Promise(resolve => setTimeout(resolve, 5));
    const clearPromise = decorated.clearContext('u1');

    gate.resolve();
    await Promise.all([runPromise, clearPromise]);

    expect(order).toEqual(['run-start', 'run-end', 'clear']);
  });

  it('compact is wrapped by the same mutex key as run — it must not race a run on the same userId', async () => {
    const order: string[] = [];
    const gate = deferred<void>();

    const run = jest.fn<Promise<RunResult>, [RunInput]>().mockImplementation(async () => {
      order.push('run-start');
      await gate.promise;
      order.push('run-end');
      return { text: 'ok', phase: 'chat', runId: 'r' };
    });
    const compact = jest.fn<Promise<'compacted'>, [string]>().mockImplementation(async () => {
      order.push('compact');
      return 'compacted';
    });
    const inner: ConversationRunPort = { run, clearContext: jest.fn(), compact };
    const decorated = withRunMutex(inner, { waitMs: 1000 });

    const runPromise = decorated.run({ userId: 'u1', text: 'x' });
    await new Promise(resolve => setTimeout(resolve, 5));
    const compactPromise = decorated.compact('u1');

    gate.resolve();
    await Promise.all([runPromise, compactPromise]);

    expect(order).toEqual(['run-start', 'run-end', 'compact']);
  });
});
