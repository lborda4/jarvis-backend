import { Injectable } from '@nestjs/common';
import { SIIGO_DOCUMENT_SEND_INTERVAL_MS } from './constants/siigo.constants';
import { sleep } from './helpers/siigo-auth.helper';

@Injectable()
export class SiigoDocumentSendThrottleService {
  private readonly startSchedulingChain = new Map<string, Promise<void>>();
  private readonly lastStartAtByCompany = new Map<string, number>();

  async acquireStartSlot(companyId: string): Promise<void> {
    const previous = this.startSchedulingChain.get(companyId) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const scheduled = previous
      .catch(() => undefined)
      .then(async () => {
        const lastStartAt = this.lastStartAtByCompany.get(companyId) ?? 0;
        const waitMs = Math.max(
          0,
          SIIGO_DOCUMENT_SEND_INTERVAL_MS - (Date.now() - lastStartAt),
        );

        if (waitMs > 0) {
          await sleep(waitMs);
        }

        this.lastStartAtByCompany.set(companyId, Date.now());
        release();
      });

    this.startSchedulingChain.set(companyId, scheduled);
    await gate;
  }

  async run<T>(companyId: string, task: () => Promise<T>): Promise<T> {
    await this.acquireStartSlot(companyId);
    return task();
  }
}
