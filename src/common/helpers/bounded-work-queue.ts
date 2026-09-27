/** A shared FIFO limit across batches, with one active/pending task per key. */
export class BoundedWorkQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly tasks = new Map<string, Promise<void>>();

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1)
      throw new Error('Invalid concurrency');
  }

  run(key: string, work: () => Promise<void>): Promise<void> {
    const existing = this.tasks.get(key);
    if (existing) return existing;
    const task = new Promise<void>((resolve, reject) => {
      this.waiting.push(() => {
        this.active++;
        Promise.resolve()
          .then(work)
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.tasks.delete(key);
            this.drain();
          });
      });
    });
    this.tasks.set(key, task);
    this.drain();
    return task;
  }

  private drain(): void {
    while (this.active < this.concurrency && this.waiting.length)
      this.waiting.shift()!();
  }
}
