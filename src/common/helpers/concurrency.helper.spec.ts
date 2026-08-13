import { mapWithConcurrency } from './concurrency.helper';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('mapWithConcurrency', () => {
  it('preserves the original order regardless of resolution order', async () => {
    const items = [30, 10, 20, 5];

    const results = await mapWithConcurrency(items, 4, async (ms) => {
      await delay(ms);
      return ms;
    });

    expect(results).toEqual([30, 10, 20, 5]);
  });

  it('never runs more than `concurrency` mappers at the same time', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;

    await mapWithConcurrency(items, 3, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      active -= 1;
      return item;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('runs every item exactly once', async () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const seen: number[] = [];

    await mapWithConcurrency(items, 5, async (item) => {
      seen.push(item);
      return item;
    });

    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it('propagates a rejection from any mapper call', async () => {
    const items = [1, 2, 3];

    await expect(
      mapWithConcurrency(items, 2, async (item) => {
        if (item === 2) {
          throw new Error('boom');
        }
        return item;
      }),
    ).rejects.toThrow('boom');
  });

  it('returns an empty array for an empty input without calling the mapper', async () => {
    const mapper = jest.fn();
    const results = await mapWithConcurrency([], 5, mapper);

    expect(results).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it('clamps concurrency to the number of items', async () => {
    const items = [1, 2];
    let maxActive = 0;
    let active = 0;

    await mapWithConcurrency(items, 100, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(1);
      active -= 1;
      return item;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
