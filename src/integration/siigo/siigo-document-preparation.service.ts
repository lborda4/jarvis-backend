import { Injectable, Logger } from '@nestjs/common';
import { ElectronicDocumentProcessingStatus } from '../../electronic-document/enums/electronic-document-processing-status.enum';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { SiigoImportValidationStatus } from './enums/siigo-import-validation-status.enum';
import {
  DocumentPreparationNextStep,
  DocumentPreparationResult,
} from './interfaces/document-preparation-result.interface';
import { SiigoAccountMappingService } from './siigo-account-mapping.service';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoValidationService } from './siigo-validation.service';
import { SiigoBatchContext } from './interfaces/siigo-batch-context.interface';

const ACCOUNT_MAPPING_REQUIRED_STATUS = 'ACCOUNT_MAPPING_REQUIRED';

@Injectable()
export class SiigoDocumentPreparationService {
  private readonly logger = new Logger(SiigoDocumentPreparationService.name);

  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly siigoValidationService: SiigoValidationService,
    private readonly siigoAccountMappingService: SiigoAccountMappingService,
    private readonly siigoAuthService: SiigoAuthService,
  ) {}

  prepareDocumentsInBackground(
    documentIds: string[],
    companyId: string,
  ): void {
    void this.prepareDocuments(documentIds, companyId);
  }

  async prepareDocuments(
    documentIds: string[],
    companyId: string,
  ): Promise<void> {
    const batchContext = await this.createBatchContext(companyId);

    await Promise.all(
      documentIds.map(async (documentId) => {
        try {
          await this.prepareSupplierAndAccounts(
            documentId,
            companyId,
            batchContext,
          );
        } catch (error) {
          this.logger.error(
            `[documentId=${documentId}] Error en preparación en segundo plano`,
            error instanceof Error ? error.stack : String(error),
          );

          await this.electronicDocumentService.updateProcessingMetadata(
            documentId,
            {
              processingStatus: ElectronicDocumentProcessingStatus.FAILED,
            },
            companyId,
          );
        }
      }),
    );
  }

  async prepareSupplierAndAccounts(
    documentId: string,
    companyId: string,
    batchContext?: SiigoBatchContext,
  ): Promise<DocumentPreparationResult> {
    const trimmedId = documentId.trim();
    let document = await this.electronicDocumentService.requireById(
      trimmedId,
      companyId,
    );

    await this.electronicDocumentService.updateProcessingMetadata(
      trimmedId,
      {
        processingStatus: ElectronicDocumentProcessingStatus.PROCESSING,
      },
      companyId,
    );

    if (document.supplierExistsInSiigo !== true) {
      const validation = await this.siigoValidationService.validateImport(
        {
          documentId: trimmedId,
        },
        companyId,
        batchContext,
      );

      document = await this.electronicDocumentService.requireById(
        trimmedId,
        companyId,
      );

      if (
        validation.status === SiigoImportValidationStatus.THIRD_PARTY_REQUIRED
      ) {
        await this.electronicDocumentService.updateProcessingMetadata(
          trimmedId,
          {
            supplierExistsInSiigo: false,
            processingStatus: ElectronicDocumentProcessingStatus.SUPPLIER_REQUIRED,
          },
          companyId,
        );

        return {
          documentId: trimmedId,
          nextStep: 'SUPPLIER_REQUIRED',
        };
      }
    }

    if (this.isAccountMappingComplete(document.status)) {
      await this.electronicDocumentService.updateProcessingMetadata(
        trimmedId,
        {
          processingStatus: ElectronicDocumentProcessingStatus.ACCOUNT_MAPPED,
        },
        companyId,
      );

      return {
        documentId: trimmedId,
        nextStep: 'READY',
      };
    }

    const accountResult =
      await this.siigoAccountMappingService.validateAccountMapping(
        {
          documentId: trimmedId,
        },
        companyId,
      );

    if (accountResult.status === ACCOUNT_MAPPING_REQUIRED_STATUS) {
      await this.electronicDocumentService.updateStatus(
        trimmedId,
        ElectronicDocumentStatus.ACCOUNT_REQUIRED,
        companyId,
      );
      await this.electronicDocumentService.updateProcessingMetadata(
        trimmedId,
        {
          processingStatus: ElectronicDocumentProcessingStatus.ACCOUNT_REQUIRED,
        },
        companyId,
      );

      return {
        documentId: trimmedId,
        nextStep: 'ACCOUNT_REQUIRED',
      };
    }

    await this.electronicDocumentService.updateProcessingMetadata(
      trimmedId,
      {
        processingStatus: ElectronicDocumentProcessingStatus.ACCOUNT_MAPPED,
      },
      companyId,
    );

    return {
      documentId: trimmedId,
      nextStep: 'READY',
    };
  }

  private async createBatchContext(companyId: string): Promise<SiigoBatchContext> {
    return {
      authContext: await this.siigoAuthService.getValidAuthContext(companyId),
      supplierByNit: new Map(),
      supplierRequestsInFlight: new Map(),
    };
  }

  private isAccountMappingComplete(status: ElectronicDocumentStatus): boolean {
    return (
      status === ElectronicDocumentStatus.ACCOUNT_MAPPED ||
      status === ElectronicDocumentStatus.READY ||
      status === ElectronicDocumentStatus.PURCHASE_CREATED
    );
  }
}
