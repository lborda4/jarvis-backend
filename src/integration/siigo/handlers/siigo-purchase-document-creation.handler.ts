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
import { resolveSiigoPurchaseConfig } from '../helpers/siigo-purchase-config.helper';
import { executeSiigoRequestWithRetries } from '../helpers/siigo-request-retry.helper';
import { SiigoDocumentCreationHandler } from '../interfaces/siigo-document-creation.handler';
import { mapElectronicDocumentToSiigoPurchase } from '../mappers/electronic-document-to-siigo-purchase.mapper';
import { SiigoAuthService } from '../siigo-auth.service';
import { SiigoPurchaseService } from '../siigo-purchase.service';
import { SiigoConfigurationCacheService } from '../siigo-configuration-cache.service';

const ALLOWED_STATUSES = new Set<ElectronicDocumentStatus>([
  ElectronicDocumentStatus.ACCOUNT_MAPPED,
  ElectronicDocumentStatus.READY,
]);

@Injectable()
export class SiigoPurchaseDocumentCreationHandler
  implements SiigoDocumentCreationHandler
{
  readonly documentType = ElectronicDocumentType.PURCHASE_INVOICE;

  private readonly logger = new Logger(SiigoPurchaseDocumentCreationHandler.name);

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoPurchaseService: SiigoPurchaseService,
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
        'La factura de compra ya fue creada en SIIGO para este documento.',
      );
    }

    if (!ALLOWED_STATUSES.has(electronicDocument.status)) {
      throw new BadRequestException(
        `El documento debe tener cuenta contable asignada antes de crear la factura de compra (estado actual: ${electronicDocument.status}).`,
      );
    }

    await this.siigoConfigurationCacheService.getPurchaseDocumentTypeId(
      companyId,
    );
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const purchaseConfig = resolveSiigoPurchaseConfig(
      integration,
      electronicDocument.companyId,
    );
    const purchasePayload = mapElectronicDocumentToSiigoPurchase(
      electronicDocument.payload,
      purchaseConfig,
    );

    try {
      const purchase = await executeSiigoRequestWithRetries(
        this.siigoAuthService,
        companyId,
        this.logger,
        'crear factura de compra',
        (accessToken, partnerId) =>
          this.siigoPurchaseService.createPurchase(
            accessToken,
            purchasePayload,
            partnerId,
          ),
      );

      const updatedDocument =
        await this.electronicDocumentService.markPurchaseCreated(
          documentId,
          purchase.id,
          companyId,
        );

      return {
        success: true,
        siigoDocument: {
          id: purchase.id,
          number: purchase.number,
          name: purchase.name,
          date: purchase.date,
          total: purchase.total,
          receiptPrefix: purchase.provider_invoice?.prefix,
          receiptNumber: purchase.provider_invoice?.number,
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
        `[documentId=${documentId}] Error al crear factura de compra en SIIGO`,
        error instanceof Error ? error.stack : String(error),
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException({
        message: 'Error inesperado al crear factura de compra en SIIGO',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
