import { BoundedWorkQueue } from './bounded-work-queue';

describe('bounded classification work', () => {
  it('completes all 65 documents across concurrent batches without exceeding the shared limit', async () => {
    const queue = new BoundedWorkQueue(4);
    let active = 0,
      peak = 0;
    const completed: number[] = [];
    await Promise.all(
      Array.from({ length: 65 }, (_, id) =>
        queue.run(String(id), async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setImmediate(resolve));
          completed.push(id);
          active--;
        }),
      ),
    );
    expect(completed).toHaveLength(65);
    expect(new Set(completed).size).toBe(65);
    expect(peak).toBe(4);
  });
  it('deduplicates queued and active work and releases slots after errors', async () => {
    const queue = new BoundedWorkQueue(1);
    const work = jest.fn().mockRejectedValue(new Error('transient'));
    const first = queue.run('company:doc', work);
    const duplicate = queue.run('company:doc', work);
    expect(first).toBe(duplicate);
    const next = jest.fn().mockResolvedValue(undefined);
    await expect(first).rejects.toThrow('transient');
    await queue.run('company:next', next);
    expect(work).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
