import { Injectable, Logger } from '@nestjs/common';
import { ElectronicDocumentsRepository } from '../../electronic-document/repositories/electronic-documents.repository';
import { OpenRouterHttpClient } from '../openrouter/clients/openrouter-http.client';
import { SiigoPurchaseAiClassificationService } from './siigo-purchase-ai-classification.service';

/** Completa cuentas vacías al entrar al historial de una empresa — sin timer. */
@Injectable()
export class SiigoPurchaseAiRecoveryService {
  private readonly logger = new Logger(SiigoPurchaseAiRecoveryService.name);
  private readonly runningCompanies = new Set<string>();
  private readonly recoveredCompanies = new Set<string>();

  constructor(
    private readonly documents: ElectronicDocumentsRepository,
    private readonly classifier: SiigoPurchaseAiClassificationService,
    private readonly openRouter: OpenRouterHttpClient,
  ) {}

  recoverForCompanyInBackground(companyId: string): void {
    void this.recoverForCompany(companyId).catch((error) => {
      this.logger.error(
        'Error recuperando sugerencias pendientes',
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  async recoverForCompany(companyId: string): Promise<void> {
    const id = companyId?.trim();
    if (
      !id ||
      this.runningCompanies.has(id) ||
      this.recoveredCompanies.has(id) ||
      !this.openRouter.isConfigured()
    ) {
      return;
    }

    this.runningCompanies.add(id);
    try {
      const missing = await this.documents.findMissingPurchaseAiSuggestions(id);
      if (missing.length === 0) {
        this.recoveredCompanies.add(id);
        return;
      }
      await this.classifier.classifyDocuments(
        missing.map((document) => document.id),
        id,
      );
      if (missing.length < 100) {
        this.recoveredCompanies.add(id);
      }
    } finally {
      this.runningCompanies.delete(id);
    }
  }
}
