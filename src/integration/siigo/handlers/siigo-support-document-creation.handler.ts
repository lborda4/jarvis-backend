import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ElectronicDocumentStatus } from '../../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentType } from '../../../electronic-document/enums/electronic-document-type.enum';
import { mapElectronicDocumentToResponse } from '../../../electronic-document/mappers/electronic-document-response.mapper';
import { ElectronicDocumentService } from '../../../electronic-document/electronic-document.service';
import { IntegrationsRepository } from '../../repositories/integrations.repository';
import { CreateSiigoDocumentResponseDto } from '../dto/create-siigo-document.dto';
import { getSiigoIntegration } from '../helpers/siigo-context.helper';
import { resolveSiigoSupportDocumentConfig } from '../helpers/siigo-support-document-config.helper';
import { executeSiigoRequestWithRetries } from '../helpers/siigo-request-retry.helper';
import { SiigoDocumentCreationHandler } from '../interfaces/siigo-document-creation.handler';
import { mapElectronicDocumentToSiigoSupportDocument } from '../mappers/electronic-document-to-siigo-support-document.mapper';
import { SiigoAuthService } from '../siigo-auth.service';
import { SiigoSupportDocumentService } from '../siigo-support-document.service';
import { SiigoConfigurationCacheService } from '../siigo-configuration-cache.service';

const ALLOWED_STATUSES = new Set<ElectronicDocumentStatus>([
  ElectronicDocumentStatus.ACCOUNT_MAPPED,
  ElectronicDocumentStatus.READY,
]);

@Injectable()
export class SiigoSupportDocumentCreationHandler
  implements SiigoDocumentCreationHandler
{
  readonly documentType = ElectronicDocumentType.SUPPORT_DOCUMENT;

  private readonly logger = new Logger(SiigoSupportDocumentCreationHandler.name);

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoSupportDocumentService: SiigoSupportDocumentService,
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
  ) {}

  async create(
    documentId: string,
    companyId: string,
  ): Promise<CreateSiigoDocumentResponseDto> {
    const electronicDocument =
      await this.electronicDocumentService.requireById(documentId, companyId);

    if (electronicDocument.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
      throw new BadRequestException(
        'El Documento Soporte ya fue creado en SIIGO para este documento.',
      );
    }

    if (!ALLOWED_STATUSES.has(electronicDocument.status)) {
      throw new BadRequestException(
        `El documento debe tener cuenta contable asignada antes de crear el Documento Soporte en SIIGO (estado actual: ${electronicDocument.status}).`,
      );
    }

    await this.siigoConfigurationCacheService.getSupportDocumentTypeId(
      companyId,
    );
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const supportDocumentConfig = resolveSiigoSupportDocumentConfig(
      integration,
      electronicDocument.companyId,
    );
    const supportDocumentPayload = mapElectronicDocumentToSiigoSupportDocument(
      electronicDocument.payload,
      supportDocumentConfig,
    );

    try {
      const supportDocument = await executeSiigoRequestWithRetries(
        this.siigoAuthService,
        companyId,
        this.logger,
        'crear Documento Soporte',
        (accessToken, partnerId) =>
          this.siigoSupportDocumentService.createSupportDocument(
            accessToken,
            supportDocumentPayload,
            partnerId,
          ),
      );

      const updatedDocument =
        await this.electronicDocumentService.markPurchaseCreated(
          documentId,
          supportDocument.id,
          companyId,
          supportDocument.number ?? null,
        );

      return {
        success: true,
        siigoDocument: {
          id: supportDocument.id,
          number: supportDocument.number,
          name: supportDocument.name,
          date: supportDocument.date,
          total: supportDocument.total,
          receiptPrefix: supportDocument.supplier_receipt_number?.prefix,
          receiptNumber: supportDocument.supplier_receipt_number?.number,
        },
        document: mapElectronicDocumentToResponse(updatedDocument),
      };
    } catch (error) {
      await this.electronicDocumentService.updateStatus(
        documentId,
        ElectronicDocumentStatus.PURCHASE_FAILED,
        companyId,
      );

      this.logger.error(
        `[documentId=${documentId}] Error al crear Documento Soporte en SIIGO`,
        error instanceof Error ? error.stack : String(error),
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException({
        message: 'Error inesperado al crear Documento Soporte en SIIGO',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
