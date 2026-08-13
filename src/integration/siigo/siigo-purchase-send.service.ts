import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { mapElectronicDocumentToResponse } from '../../electronic-document/mappers/electronic-document-response.mapper';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { CreateSiigoSupportDocumentRequestDto } from './dto/create-siigo-support-document.dto';
import {
  CreateSiigoPurchaseSendRequestDto,
  CreateSiigoPurchaseSendResponseDto,
} from './dto/create-siigo-purchase-send.dto';
import { DeleteSiigoPurchaseResponseDto } from './dto/delete-siigo-purchase.dto';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { SIIGO_DOCUMENT_SEND_RETRY_OPTIONS } from './constants/siigo.constants';
import { validateSupportDocumentRetentions } from './helpers/siigo-support-document-retention.helper';
import {
  buildSupplierPreferenceSnapshotFromSendRequest,
  persistSupplierPreferencesFromSendRequest,
} from './helpers/siigo-support-document-preference.helper';
import { mapCreatePurchaseSendRequestToSiigo } from './mappers/create-siigo-purchase-send-request.mapper';
import { SiigoAccountMappingService } from './siigo-account-mapping.service';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';
import { SiigoDocumentSendThrottleService } from './siigo-document-send-throttle.service';
import { PlanSubscriptionService } from '../../plan/plan-subscription.service';
import { IntegrationProvider } from '../enums/integration-provider.enum';

@Injectable()
export class SiigoPurchaseSendService {
  private readonly logger = new Logger(SiigoPurchaseSendService.name);

  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
    private readonly siigoHttpClient: SiigoHttpClient,
    private readonly siigoTaxesCatalogService: SiigoTaxesCatalogService,
    private readonly siigoAccountMappingService: SiigoAccountMappingService,
    private readonly siigoDocumentSendThrottleService: SiigoDocumentSendThrottleService,
    private readonly planSubscriptionService: PlanSubscriptionService,
  ) {}

  async sendPurchase(
    request: CreateSiigoPurchaseSendRequestDto,
    companyId: string,
  ): Promise<CreateSiigoPurchaseSendResponseDto> {
    await this.planSubscriptionService.assertCanCreateDocuments({
      companyId,
      provider: IntegrationProvider.SIIGO,
      documentType: ElectronicDocumentType.PURCHASE_INVOICE,
      quantity: 1,
    });

    const documentId = request.documentId.trim();
    const electronicDocument =
      await this.electronicDocumentService.requireById(documentId, companyId);

    if (
      electronicDocument.electronicDocumentType !==
      ElectronicDocumentType.PURCHASE_INVOICE
    ) {
      throw new BadRequestException(
        'El documento indicado no es una factura de compra.',
      );
    }

    if (electronicDocument.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
      throw new BadRequestException(
        'La factura de compra ya fue creada en SIIGO para este registro.',
      );
    }

    const purchaseConfig =
      await this.siigoConfigurationCacheService.getPurchaseConfig(companyId);
    const taxesCatalog = await this.siigoTaxesCatalogService.listTaxes(
      {},
      companyId,
    );
    validateSupportDocumentRetentions(
      (request.retentions ?? []).map((retention) => retention.id),
      taxesCatalog,
    );

    const hasIva = (electronicDocument.payload?.totals?.iva ?? 0) > 0;
    const siigoPayload = mapCreatePurchaseSendRequestToSiigo(
      request,
      purchaseConfig.documentId,
      taxesCatalog,
      purchaseConfig.defaultTaxId,
      hasIva,
    );

    const requestedPaymentValue = request.payments.reduce(
      (sum, payment) => sum + payment.value,
      0,
    );
    const calculatedPaymentValue = siigoPayload.payments.reduce(
      (sum, payment) => sum + payment.value,
      0,
    );

    if (requestedPaymentValue !== calculatedPaymentValue) {
      this.logger.log(
        `[documentId=${documentId}] payments.value recalculado para SIIGO (requested=${requestedPaymentValue}, calculated=${calculatedPaymentValue})`,
      );
    }

    const siigoDocumentTypeId =
      await this.siigoConfigurationCacheService.getPurchaseDocumentTypeId(
        companyId,
      );
    siigoPayload.document.id = siigoDocumentTypeId;

    if (request.cost_center !== undefined) {
      siigoPayload.cost_center = request.cost_center;
    }

    // Se guarda la preferencia del proveedor (cuenta, medio de pago,
    // retenciones, centro de costo) ANTES de intentar el envío a SIIGO, no
    // solo si tiene éxito: así la elección del usuario sobrevive aunque el
    // envío falle (p. ej. un error de negocio de SIIGO) y no se pierde al
    // cerrar sesión, ya que se guarda en la tabla de preferencias del
    // proveedor, no solo en el estado en memoria del navegador.
    const preferenceSnapshot = buildSupplierPreferenceSnapshotFromSendRequest(
      request as unknown as CreateSiigoSupportDocumentRequestDto,
      taxesCatalog,
    );

    if (preferenceSnapshot) {
      await this.siigoAccountMappingService.persistSupplierPreferenceSnapshot(
        electronicDocument,
        companyId,
        preferenceSnapshot,
      );
    }

    if (request.savePreferences) {
      await persistSupplierPreferencesFromSendRequest(
        this.siigoAccountMappingService,
        request,
        electronicDocument,
        companyId,
        taxesCatalog,
        this.logger,
      );
    }

    try {
      const createdPurchase = await this.siigoDocumentSendThrottleService.run(
        companyId,
        () =>
          executeSiigoRequestWithRetries(
            this.siigoAuthService,
            companyId,
            this.logger,
            'crear factura de compra',
            async (accessToken, partnerId) =>
              this.siigoHttpClient.createPurchase(
                accessToken,
                siigoPayload,
                partnerId,
              ),
            SIIGO_DOCUMENT_SEND_RETRY_OPTIONS,
          ),
      );

      const updatedDocument =
        await this.electronicDocumentService.markPurchaseCreated(
          documentId,
          createdPurchase.id,
          companyId,
          createdPurchase.number ?? null,
          preferenceSnapshot
            ? {
                ...electronicDocument.payload,
                siigoSendConfiguration: preferenceSnapshot,
              }
            : undefined,
        );

      return {
        success: true,
        purchase: {
          id: createdPurchase.id,
          number: createdPurchase.number,
          name: createdPurchase.name,
          date: createdPurchase.date,
          total: createdPurchase.total,
          providerInvoicePrefix: createdPurchase.provider_invoice?.prefix,
          providerInvoiceNumber: createdPurchase.provider_invoice?.number,
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
        `[documentId=${documentId}] Error al enviar factura de compra a SIIGO`,
        error instanceof Error ? error.stack : String(error),
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException(
        error instanceof Error
          ? error.message
          : 'Error inesperado al crear factura de compra en SIIGO',
      );
    }
  }

  async deletePurchase(
    documentId: string,
    companyId: string,
  ): Promise<DeleteSiigoPurchaseResponseDto> {
    const trimmedDocumentId = documentId.trim();
    const electronicDocument = await this.electronicDocumentService.requireById(
      trimmedDocumentId,
      companyId,
    );

    if (
      electronicDocument.electronicDocumentType !==
      ElectronicDocumentType.PURCHASE_INVOICE
    ) {
      throw new BadRequestException(
        'El documento indicado no es una factura de compra.',
      );
    }

    if (electronicDocument.status !== ElectronicDocumentStatus.PURCHASE_CREATED) {
      throw new BadRequestException(
        'La factura de compra no está creada en SIIGO.',
      );
    }

    const siigoPurchaseId = electronicDocument.siigoPurchaseId?.trim();

    if (!siigoPurchaseId) {
      throw new BadRequestException(
        'El documento no tiene un id de factura de compra en SIIGO.',
      );
    }

    try {
      await this.siigoDocumentSendThrottleService.run(companyId, () =>
        executeSiigoRequestWithRetries(
          this.siigoAuthService,
          companyId,
          this.logger,
          'eliminar factura de compra',
          async (accessToken, partnerId) =>
            this.siigoHttpClient.deletePurchase(
              accessToken,
              siigoPurchaseId,
              partnerId,
            ),
          SIIGO_DOCUMENT_SEND_RETRY_OPTIONS,
        ),
      );

      const updatedDocument =
        await this.electronicDocumentService.clearPurchaseCreated(
          trimmedDocumentId,
          companyId,
        );

      this.logger.log(
        `[documentId=${trimmedDocumentId}] Factura de compra eliminada en SIIGO (siigoId=${siigoPurchaseId})`,
      );

      return {
        success: true,
        siigoPurchaseId,
        document: mapElectronicDocumentToResponse(updatedDocument),
      };
    } catch (error) {
      this.logger.error(
        `[documentId=${trimmedDocumentId}] Error al eliminar factura de compra en SIIGO (siigoId=${siigoPurchaseId})`,
        error instanceof Error ? error.stack : String(error),
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException(
        error instanceof Error
          ? error.message
          : 'Error inesperado al eliminar factura de compra en SIIGO',
      );
    }
  }

}
