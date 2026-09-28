import { type ConversationErrorCode, HTTP_STATUS_BY_CODE, ThreadBusyError } from '@domain/conversation/ports';

import { createKeyedMutex } from '@infra/conversation/keyed-mutex';

describe('createKeyedMutex (D-12, ADR-0013 §6)', () => {
  it('D-12: same key — the second fn starts only after the first settles', async () => {
    const mutex = createKeyedMutex({ waitMs: 1000 });
    const starts: number[] = [];
    const ends: number[] = [];

    const first = mutex.run('user-1', async () => {
      starts.push(Date.now());
      await new Promise(resolve => setTimeout(resolve, 50));
      ends.push(Date.now());
      return 'first';
    });

    // Give the first run a tick to actually start before enqueueing the second.
    await new Promise(resolve => setTimeout(resolve, 5));

    const second = mutex.run('user-1', async () => {
      starts.push(Date.now());
      ends.push(Date.now());
      return 'second';
    });

    const results = await Promise.all([first, second]);

    expect(results).toEqual(['first', 'second']);
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    // The second fn must not start before the first one ended.
    expect(starts[1]).toBeGreaterThanOrEqual(ends[0]);
  });

  it('D-12: different keys — both fns are entered before either settles', async () => {
    const mutex = createKeyedMutex({ waitMs: 1000 });
    const entered: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    const first = mutex.run('user-1', async () => {
      entered.push('user-1');
      await firstGate;
      return 'first';
    });

    // Let the first fn actually enter before starting the second.
    await new Promise(resolve => setTimeout(resolve, 5));

    const second = mutex.run('user-2', async () => {
      entered.push('user-2');
      return 'second';
    });

    // Both must have entered while `first` is still pending on its gate.
    await second;
    expect(entered).toEqual(['user-1', 'user-2']);

    releaseFirst();
    await first;
  });

  it('D-12: a rejecting fn releases the key — the next waiter still acquires', async () => {
    const mutex = createKeyedMutex({ waitMs: 1000 });

    await expect(
      mutex.run('user-1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(mutex.run('user-1', async () => 'ok-after-failure')).resolves.toBe('ok-after-failure');
  });

  it('D-12/ADR-0013 §6: a waiter exceeding waitMs rejects with ThreadBusyError coded THREAD_BUSY', async () => {
    const mutex = createKeyedMutex({ waitMs: 20 });
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    const first = mutex.run('user-1', async () => {
      await firstGate;
      return 'first';
    });

    const second = mutex.run('user-1', async () => 'second');

    await expect(second).rejects.toThrow(ThreadBusyError);
    await expect(second).rejects.toMatchObject({ code: 'THREAD_BUSY' });

    releaseFirst();
    await first;
  });

  it('D-12: the internal map returns to size() === 0 after all runs settle', async () => {
    const mutex = createKeyedMutex({ waitMs: 1000 });

    await Promise.all([
      mutex.run('user-1', async () => 'a'),
      mutex.run('user-2', async () => 'b'),
      mutex.run('user-1', async () => 'c'),
    ]);

    expect(mutex.size()).toBe(0);
  });

  it('ADR-0013 §6: HTTP_STATUS_BY_CODE covers every declared ConversationErrorCode', () => {
    const codes: ConversationErrorCode[] = ['LLM_UNAVAILABLE', 'THREAD_BUSY', 'USER_NOT_FOUND', 'CORE_ERROR'];

    for (const code of codes) {
      expect(HTTP_STATUS_BY_CODE[code]).toBeDefined();
    }
    expect(Object.keys(HTTP_STATUS_BY_CODE).sort()).toEqual([...codes].sort());
  });
});
