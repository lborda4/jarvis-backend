import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ElectronicDocumentsRepository } from '../../electronic-document/repositories/electronic-documents.repository';
import { OpenRouterHttpClient } from '../openrouter/clients/openrouter-http.client';
import { SiigoPurchaseAiClassificationService } from './siigo-purchase-ai-classification.service';

/** Reconciles durable documents with suggestions, even if an import callback was lost. */
@Injectable()
export class SiigoPurchaseAiRecoveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SiigoPurchaseAiRecoveryService.name);
  private readonly retryAfter = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private running = false;

  constructor(
    private readonly documents: ElectronicDocumentsRepository,
    private readonly classifier: SiigoPurchaseAiClassificationService,
    private readonly openRouter: OpenRouterHttpClient,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(1000);
  }
  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.recoverMissingSuggestions()
        .catch((error) => {
          this.logger.error(
            'Error recuperando sugerencias pendientes',
            error instanceof Error ? error.stack : String(error),
          );
        })
        .finally(() => this.schedule(30000));
    }, delay);
    this.timer.unref();
  }

  async recoverMissingSuggestions(): Promise<void> {
    if (this.running || this.stopped || !this.openRouter.isConfigured()) return;
    this.running = true;
    try {
      const now = Date.now();
      for (const [id, retryAt] of this.retryAfter)
        if (retryAt <= now) this.retryAfter.delete(id);
      const missing = await this.documents.findMissingPurchaseAiSuggestions([
        ...this.retryAfter.keys(),
      ]);
      const byCompany = new Map<string, string[]>();
      for (const document of missing) {
        byCompany.set(document.companyId, [
          ...(byCompany.get(document.companyId) ?? []),
          document.id,
        ]);
      }
      for (const [companyId, ids] of byCompany) {
        if (this.stopped) break;
        try {
          await this.classifier.classifyDocuments(ids, companyId);
        } finally {
          // Unavailable catalogs/providers must not cause a tight, billable retry loop.
          for (const id of ids)
            this.retryAfter.set(id, Date.now() + 5 * 60 * 1000);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
