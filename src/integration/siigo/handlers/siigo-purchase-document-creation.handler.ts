import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElectronicDocumentStatus } from '../../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentType } from '../../../electronic-document/enums/electronic-document-type.enum';
import { mapElectronicDocumentToResponse } from '../../../electronic-document/mappers/electronic-document-response.mapper';
import { ElectronicDocumentService } from '../../../electronic-document/electronic-document.service';
import { CreateSiigoDocumentResponseDto } from '../dto/create-siigo-document.dto';
import { executeSiigoRequestWithRetries } from '../helpers/siigo-request-retry.helper';
import { SiigoDocumentCreationHandler } from '../interfaces/siigo-document-creation.handler';
import { mapElectronicDocumentToSiigoPurchase } from '../mappers/electronic-document-to-siigo-purchase.mapper';
import { SiigoAuthService } from '../siigo-auth.service';
import { SiigoHttpClient } from '../clients/siigo-http.client';
import { SiigoConfigurationCacheService } from '../siigo-configuration-cache.service';
import { AppConfiguration } from '../../../config/configuration';

const ALLOWED_STATUSES = new Set<ElectronicDocumentStatus>([
  ElectronicDocumentStatus.ACCOUNT_MAPPED,
  ElectronicDocumentStatus.READY,
]);

@Injectable()
export class SiigoPurchaseDocumentCreationHandler implements SiigoDocumentCreationHandler {
  readonly documentType = ElectronicDocumentType.PURCHASE_INVOICE;

  private readonly logger = new Logger(
    SiigoPurchaseDocumentCreationHandler.name,
  );

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoHttpClient: SiigoHttpClient,
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  async create(
    documentId: string,
    companyId: string,
  ): Promise<CreateSiigoDocumentResponseDto> {
    const electronicDocument = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );

    if (
      electronicDocument.status === ElectronicDocumentStatus.PURCHASE_CREATED
    ) {
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
    const purchaseConfig =
      await this.siigoConfigurationCacheService.getPurchaseConfig(companyId);
    const purchasePayload = mapElectronicDocumentToSiigoPurchase(
      electronicDocument.payload,
      purchaseConfig,
      {
        defaultTaxRate: this.configService.get('siigo.defaultTaxRate', {
          infer: true,
        }),
      },
    );

    try {
      return await this.electronicDocumentService.runExclusiveForDocumentCreation(
        documentId,
        companyId,
        async () => {
          const purchase = await executeSiigoRequestWithRetries(
            this.siigoAuthService,
            companyId,
            this.logger,
            'crear factura de compra',
            (accessToken, partnerId) =>
              this.siigoHttpClient.createPurchase(
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
        },
      );
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
