import { Injectable, Logger } from '@nestjs/common';
import { DianInvoiceResult } from '../dian/interfaces/dian-invoice-result.interface';
import { generateRquid } from '../common/helpers/rquid.helper';
import { ImportSessionStore } from './import-session.store';
import { ImportSessionData } from './interfaces/import-session.interface';

@Injectable()
export class ImportSessionService {
  private readonly logger = new Logger(ImportSessionService.name);

  constructor(private readonly importSessionStore: ImportSessionStore) {}

  async createSession(
    parsedInvoice: DianInvoiceResult,
    options?: {
      electronicDocumentId?: string;
      companyId?: string;
    },
  ): Promise<ImportSessionData> {
    const now = new Date().toISOString();
    const session: ImportSessionData = {
      rquid: generateRquid(),
      parsedInvoice,
      electronicDocumentId: options?.electronicDocumentId,
      companyId: options?.companyId,
      createdAt: now,
      updatedAt: now,
    };

    await this.importSessionStore.save(session);
    this.logger.log(`[rquid=${session.rquid}] Sesión de importación creada`);

    return session;
  }
}
