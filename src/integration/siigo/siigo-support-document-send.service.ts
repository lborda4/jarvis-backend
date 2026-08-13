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
import {
  CreateSiigoSupportDocumentRequestDto,
  CreateSiigoSupportDocumentResponseDto,
} from './dto/create-siigo-support-document.dto';
import { DeleteSiigoSupportDocumentResponseDto } from './dto/delete-siigo-support-document.dto';
import { SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED } from './constants/siigo.constants';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { SIIGO_DOCUMENT_SEND_RETRY_OPTIONS } from './constants/siigo.constants';
import { mapCreateSupportDocumentRequestToSiigo } from './mappers/create-siigo-support-document-request.mapper';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoDocumentTypesService } from './siigo-document-types.service';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';
import { validateSupportDocumentRetentions } from './helpers/siigo-support-document-retention.helper';
import {
  buildSupplierPreferenceSnapshotFromSendRequest,
  persistSupplierPreferencesFromSendRequest,
} from './helpers/siigo-support-document-preference.helper';
import { SiigoAccountMappingService } from './siigo-account-mapping.service';
import { SiigoDocumentSendThrottleService } from './siigo-document-send-throttle.service';
import { PlanSubscriptionService } from '../../plan/plan-subscription.service';
import { IntegrationProvider } from '../enums/integration-provider.enum';

@Injectable()
export class SiigoSupportDocumentSendService {
  private readonly logger = new Logger(SiigoSupportDocumentSendService.name);

  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoDocumentTypesService: SiigoDocumentTypesService,
    private readonly siigoHttpClient: SiigoHttpClient,
    private readonly siigoTaxesCatalogService: SiigoTaxesCatalogService,
    private readonly siigoAccountMappingService: SiigoAccountMappingService,
    private readonly siigoDocumentSendThrottleService: SiigoDocumentSendThrottleService,
    private readonly planSubscriptionService: PlanSubscriptionService,
  ) {}

  async sendSupportDocument(
    request: CreateSiigoSupportDocumentRequestDto,
    companyId: string,
  ): Promise<CreateSiigoSupportDocumentResponseDto> {
    await this.planSubscriptionService.assertCanCreateDocuments({
      companyId,
      provider: IntegrationProvider.SIIGO,
      documentType: ElectronicDocumentType.SUPPORT_DOCUMENT,
      quantity: 1,
    });

    const documentId = request.documentId.trim();
    const electronicDocument =
      await this.electronicDocumentService.requireById(documentId, companyId);

    if (
      electronicDocument.electronicDocumentType !==
      ElectronicDocumentType.SUPPORT_DOCUMENT
    ) {
      throw new BadRequestException(
        'El documento indicado no es un Documento Soporte.',
      );
    }

    if (electronicDocument.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
      throw new BadRequestException(
        'El Documento Soporte ya fue creado en SIIGO para este registro.',
      );
    }

    const sendStamp = SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED;
    const taxesCatalog = await this.siigoTaxesCatalogService.listTaxes(
      {},
      companyId,
    );
    validateSupportDocumentRetentions(
      (request.retentions ?? []).map((retention) => retention.id),
      taxesCatalog,
    );
    const siigoPayload = mapCreateSupportDocumentRequestToSiigo(
      request,
      0,
      taxesCatalog,
      sendStamp,
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
      await this.siigoDocumentTypesService.resolveSupportDocumentTypeId(
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
      request,
      taxesCatalog,
    );

    if (preferenceSnapshot) {
      await this.siigoAccountMappingService.persistSupplierPreferenceSnapshot(
        electronicDocument,
        companyId,
        preferenceSnapshot,
      );

      this.logger.log(
        `[documentId=${documentId}] Preferencia de proveedor actualizada antes del envío`,
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
      const createdSupportDocument =
        await this.siigoDocumentSendThrottleService.run(companyId, () =>
          executeSiigoRequestWithRetries(
            this.siigoAuthService,
            companyId,
            this.logger,
            'crear Documento Soporte',
            async (accessToken, partnerId) =>
              this.siigoHttpClient.createSupportDocument(
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
          createdSupportDocument.id,
          companyId,
          createdSupportDocument.number != null
            ? String(createdSupportDocument.number)
            : null,
          preferenceSnapshot
            ? {
                ...electronicDocument.payload,
                siigoSendConfiguration: preferenceSnapshot,
              }
            : undefined,
        );

      return {
        success: true,
        supportDocument: {
          id: createdSupportDocument.id,
          number: createdSupportDocument.number,
          name: createdSupportDocument.name,
          date: createdSupportDocument.date,
          total: createdSupportDocument.total,
          receiptPrefix:
            createdSupportDocument.supplier_receipt_number?.prefix,
          receiptNumber:
            createdSupportDocument.supplier_receipt_number?.number,
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
        `[documentId=${documentId}] Error al enviar Documento Soporte a SIIGO`,
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
          : 'Error inesperado al crear Documento Soporte en SIIGO',
      );
    }
  }

  async deleteSupportDocument(
    documentId: string,
    companyId: string,
  ): Promise<DeleteSiigoSupportDocumentResponseDto> {
    const trimmedDocumentId = documentId.trim();
    const electronicDocument =
      await this.electronicDocumentService.requireById(
        trimmedDocumentId,
        companyId,
      );

    if (
      electronicDocument.electronicDocumentType !==
      ElectronicDocumentType.SUPPORT_DOCUMENT
    ) {
      throw new BadRequestException(
        'El documento indicado no es un Documento Soporte.',
      );
    }

    if (electronicDocument.status !== ElectronicDocumentStatus.PURCHASE_CREATED) {
      throw new BadRequestException(
        'El Documento Soporte no está creado en SIIGO.',
      );
    }

    const siigoSupportDocumentId = electronicDocument.siigoPurchaseId?.trim();

    if (!siigoSupportDocumentId) {
      throw new BadRequestException(
        'El documento no tiene un id de Documento Soporte en SIIGO.',
      );
    }

    try {
      await this.siigoDocumentSendThrottleService.run(companyId, () =>
        executeSiigoRequestWithRetries(
          this.siigoAuthService,
          companyId,
          this.logger,
          'eliminar Documento Soporte',
          async (accessToken, partnerId) =>
            this.siigoHttpClient.deleteSupportDocument(
              accessToken,
              siigoSupportDocumentId,
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
        `[documentId=${trimmedDocumentId}] Documento Soporte eliminado en SIIGO (siigoId=${siigoSupportDocumentId})`,
      );

      return {
        success: true,
        siigoSupportDocumentId,
        document: mapElectronicDocumentToResponse(updatedDocument),
      };
    } catch (error) {
      this.logger.error(
        `[documentId=${trimmedDocumentId}] Error al eliminar Documento Soporte en SIIGO (siigoId=${siigoSupportDocumentId})`,
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
          : 'Error inesperado al eliminar Documento Soporte en SIIGO',
      );
    }
  }

}
