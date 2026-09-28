import { createChatQueue } from '../queue';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

describe('createChatQueue (D-G)', () => {
    it('D-G: two enqueues for one chatId run sequentially — the second fn starts only after the first settles', async () => {
        const queue = createChatQueue();
        const starts: number[] = [];
        const ends: number[] = [];
        const gate = deferred<void>();

        const first = queue.enqueue(1, async () => {
            starts.push(Date.now());
            await gate.promise;
            ends.push(Date.now());
        });

        await new Promise((resolve) => setTimeout(resolve, 5));

        const second = queue.enqueue(1, async () => {
            starts.push(Date.now());
            ends.push(Date.now());
        });

        gate.resolve();
        await Promise.all([first, second]);

        expect(starts).toHaveLength(2);
        expect(starts[1]).toBeGreaterThanOrEqual(ends[0]);
    });

    it('D-G: two different chatIds overlap — both fns are entered before either settles', async () => {
        const queue = createChatQueue();
        const entered: number[] = [];
        const gate = deferred<void>();

        const first = queue.enqueue(1, async () => {
            entered.push(1);
            await gate.promise;
        });

        await new Promise((resolve) => setTimeout(resolve, 5));

        const second = queue.enqueue(2, async () => {
            entered.push(2);
        });

        await second;
        expect(entered).toEqual([1, 2]);

        gate.resolve();
        await first;
    });

    it('D-G: a rejecting fn does not wedge the chain — the next enqueue for the same chatId still runs', async () => {
        const queue = createChatQueue();

        await expect(
            queue.enqueue(1, async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');

        await expect(queue.enqueue(1, async () => 'ok-after-failure')).resolves.toBe('ok-after-failure');
    });
});
