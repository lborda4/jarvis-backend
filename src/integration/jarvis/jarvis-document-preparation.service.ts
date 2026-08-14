import { Injectable, Logger } from '@nestjs/common';
import { ResumeElectronicDocumentResponseDto } from '../../electronic-document/dto/resume-electronic-document.dto';
import { mapElectronicDocumentToListItem } from '../../electronic-document/mappers/electronic-document-list-item.mapper';
import { ElectronicDocumentProcessingStatus } from '../../electronic-document/enums/electronic-document-processing-status.enum';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { JarvisTercerosRepository } from './repositories/jarvis-terceros.repository';
import {
  normalizeJarvisDocumentNumber,
  normalizeJarvisDocumentType,
} from './helpers/jarvis-document-number.helper';

@Injectable()
export class JarvisDocumentPreparationService {
  private readonly logger = new Logger(JarvisDocumentPreparationService.name);

  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly jarvisTercerosRepository: JarvisTercerosRepository,
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
    await Promise.all(
      documentIds.map(async (documentId) => {
        try {
          await this.prepareTercero(documentId, companyId);
        } catch (error) {
          this.logger.error(
            `[documentId=${documentId}] Error en preparación Jarvis`,
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

  async resume(
    documentId: string,
    companyId: string,
  ): Promise<ResumeElectronicDocumentResponseDto> {
    const result = await this.prepareTercero(documentId, companyId);
    const document = await this.electronicDocumentService.requireById(
      result.documentId,
      companyId,
    );

    return {
      nextStep:
        result.nextStep === 'SUPPLIER_REQUIRED'
          ? 'SUPPLIER_REQUIRED'
          : 'ACCOUNT_REQUIRED',
      document: mapElectronicDocumentToListItem(document),
    };
  }

  async prepareTercero(
    documentId: string,
    companyId: string,
  ): Promise<{ documentId: string; nextStep: 'SUPPLIER_REQUIRED' | 'READY' }> {
    const trimmedId = documentId.trim();
    const document = await this.electronicDocumentService.requireById(
      trimmedId,
      companyId,
    );

    if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
      return {
        documentId: trimmedId,
        nextStep: 'READY',
      };
    }

    await this.electronicDocumentService.updateProcessingMetadata(
      trimmedId,
      {
        processingStatus: ElectronicDocumentProcessingStatus.PROCESSING,
      },
      companyId,
    );

    const documentNumber = normalizeJarvisDocumentNumber(
      document.payload.supplier.documentNumber ||
        document.documentNumberThird ||
        '',
    );
    const documentType = normalizeJarvisDocumentType(
      document.payload.supplier.documentType || document.documentTypeThird,
    );

    const tercero = documentNumber
      ? await this.jarvisTercerosRepository.findByCompanyAndDocument(
          companyId,
          documentType,
          documentNumber,
        )
      : null;

    if (!tercero) {
      await this.electronicDocumentService.updateStatus(
        trimmedId,
        ElectronicDocumentStatus.SUPPLIER_NOT_FOUND,
        companyId,
      );
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

    await this.electronicDocumentService.updatePayload(
      trimmedId,
      {
        ...document.payload,
        supplier: {
          ...document.payload.supplier,
          name: tercero.name,
          commercialName: tercero.name,
        },
      },
      companyId,
    );

    await this.electronicDocumentService.updateStatus(
      trimmedId,
      ElectronicDocumentStatus.ACCOUNT_MAPPED,
      companyId,
    );
    await this.electronicDocumentService.updateProcessingMetadata(
      trimmedId,
      {
        supplierExistsInSiigo: true,
        processingStatus: ElectronicDocumentProcessingStatus.ACCOUNT_MAPPED,
      },
      companyId,
    );

    await this.resolvePendingSiblings(
      trimmedId,
      companyId,
      documentNumber,
      tercero.name,
    );

    return {
      documentId: trimmedId,
      nextStep: 'READY',
    };
  }

  /**
   * Al crear/encontrar el tercero para un documento, otros documentos ya
   * importados del mismo proveedor (mismo NIT) que quedaron esperando a que
   * el tercero existiera no se enteran solos — se actualizan aquí también,
   * en vez de quedar en "Requiere proveedor" hasta que alguien reintente
   * uno por uno.
   */
  private async resolvePendingSiblings(
    resolvedDocumentId: string,
    companyId: string,
    documentNumberThird: string,
    supplierName: string,
  ): Promise<void> {
    const siblings = await this.electronicDocumentService.findSupplierNotFoundSiblings(
      companyId,
      documentNumberThird,
      resolvedDocumentId,
    );

    await Promise.all(
      siblings.map(async (sibling) => {
        try {
          await this.electronicDocumentService.updatePayloadAndStatus(
            sibling.id,
            {
              ...sibling.payload,
              supplier: {
                ...sibling.payload.supplier,
                name: supplierName,
                commercialName: supplierName,
              },
            },
            ElectronicDocumentStatus.ACCOUNT_MAPPED,
            companyId,
          );
          await this.electronicDocumentService.updateProcessingMetadata(
            sibling.id,
            {
              supplierExistsInSiigo: true,
              processingStatus: ElectronicDocumentProcessingStatus.ACCOUNT_MAPPED,
            },
            companyId,
          );
        } catch (error) {
          this.logger.error(
            `[documentId=${sibling.id}] Error al propagar tercero resuelto`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }),
    );
  }

}
