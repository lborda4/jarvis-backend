import {
  BadGatewayException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { mapElectronicDocumentToListItem } from '../../electronic-document/mappers/electronic-document-list-item.mapper';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { ResumeElectronicDocumentResponseDto } from '../../electronic-document/dto/resume-electronic-document.dto';
import { ResumeElectronicDocumentsBatchResponseDto } from '../../electronic-document/dto/resume-electronic-documents-batch.dto';
import { SiigoDocumentPreparationService } from './siigo-document-preparation.service';
import { SiigoDocumentCreationService } from './siigo-document-creation.service';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoBatchContext } from './interfaces/siigo-batch-context.interface';

@Injectable()
export class SiigoDocumentResumeService {
  private readonly logger = new Logger(SiigoDocumentResumeService.name);

  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly siigoDocumentPreparationService: SiigoDocumentPreparationService,
    private readonly siigoDocumentCreationService: SiigoDocumentCreationService,
    private readonly siigoAuthService: SiigoAuthService,
  ) {}

  async resumeBatch(
    documentIds: string[],
    companyId: string,
    options?: { prepareOnly?: boolean },
  ): Promise<ResumeElectronicDocumentsBatchResponseDto> {
    const uniqueIds = [
      ...new Set(documentIds.map((documentId) => documentId?.trim()).filter(Boolean)),
    ];

    if (uniqueIds.length === 0) {
      return { items: [] };
    }

    const batchContext = await this.createBatchContext(companyId);
    const prepareOnly = options?.prepareOnly ?? true;
    const items = await Promise.all(
      uniqueIds.map((documentId) =>
        this.resume(documentId, companyId, batchContext, { prepareOnly }),
      ),
    );

    return { items };
  }

  async resume(
    documentId: string,
    companyId: string,
    batchContext?: SiigoBatchContext,
    options?: { prepareOnly?: boolean },
  ): Promise<ResumeElectronicDocumentResponseDto> {
    const trimmedId = documentId?.trim();
    const document = await this.electronicDocumentService.requireById(
      trimmedId,
      companyId,
    );

    if (document.status === ElectronicDocumentStatus.SUPPLIER_NOT_FOUND) {
      return this.buildResponse('SUPPLIER_REQUIRED', document.id, companyId);
    }

    if (
      (document.status === ElectronicDocumentStatus.ACCOUNT_REQUIRED ||
        document.status === ElectronicDocumentStatus.ACCOUNT_MAPPING_REQUIRED) &&
      document.supplierExistsInSiigo === true
    ) {
      return this.buildResponse('ACCOUNT_REQUIRED', document.id, companyId);
    }

    if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
      return this.buildResponse('COMPLETED', document.id, companyId);
    }

    try {
      const preparationResult =
        await this.siigoDocumentPreparationService.prepareSupplierAndAccounts(
          trimmedId,
          companyId,
          batchContext,
        );

      if (preparationResult.nextStep === 'SUPPLIER_REQUIRED') {
        return this.buildResponse('SUPPLIER_REQUIRED', document.id, companyId);
      }

      if (preparationResult.nextStep === 'ACCOUNT_REQUIRED') {
        return this.buildResponse('ACCOUNT_REQUIRED', document.id, companyId);
      }

      const refreshedDocument = await this.electronicDocumentService.requireById(
        trimmedId,
        companyId,
      );
      const shouldCreateInSiigo =
        !options?.prepareOnly &&
        refreshedDocument.electronicDocumentType !==
          ElectronicDocumentType.SUPPORT_DOCUMENT;

      if (!shouldCreateInSiigo) {
        return this.buildResponse('ACCOUNT_REQUIRED', document.id, companyId);
      }

      await this.siigoDocumentCreationService.createInSiigo(
        trimmedId,
        companyId,
      );

      return this.buildResponse('COMPLETED', document.id, companyId);
    } catch (error) {
      this.logger.error(
        `[documentId=${trimmedId}] Error al reanudar documento`,
        error instanceof Error ? error.stack : String(error),
      );

      const message =
        error instanceof BadGatewayException || error instanceof Error
          ? error.message
          : 'No se pudo reanudar el proceso del documento.';

      const refreshed = await this.electronicDocumentService.requireById(
        trimmedId,
        companyId,
      );

      if (refreshed.status === ElectronicDocumentStatus.SUPPLIER_NOT_FOUND) {
        return this.buildResponse('SUPPLIER_REQUIRED', document.id, companyId, message);
      }

      if (
        refreshed.status === ElectronicDocumentStatus.ACCOUNT_REQUIRED ||
        refreshed.status === ElectronicDocumentStatus.ACCOUNT_MAPPING_REQUIRED
      ) {
        return this.buildResponse('ACCOUNT_REQUIRED', document.id, companyId, message);
      }

      return this.buildResponse('FAILED', document.id, companyId, message);
    }
  }

  private async buildResponse(
    nextStep: ResumeElectronicDocumentResponseDto['nextStep'],
    documentId: string,
    companyId: string,
    message?: string,
  ): Promise<ResumeElectronicDocumentResponseDto> {
    const document = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );

    return {
      nextStep,
      message,
      document: mapElectronicDocumentToListItem(document),
    };
  }

  private async createBatchContext(companyId: string): Promise<SiigoBatchContext> {
    return {
      authContext: await this.siigoAuthService.getValidAuthContext(companyId),
      localSupplierNamesByNit: new Map(),
      supplierByNit: new Map(),
      supplierRequestsInFlight: new Map(),
    };
  }
}
