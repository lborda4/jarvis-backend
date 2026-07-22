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
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { SIIGO_DOCUMENT_SEND_RETRY_OPTIONS } from './constants/siigo.constants';
import { validateSupportDocumentRetentions } from './helpers/siigo-support-document-retention.helper';
import { buildSupplierPreferenceSnapshotFromSendRequest } from './helpers/siigo-support-document-preference.helper';
import { mapCreatePurchaseSendRequestToSiigo } from './mappers/create-siigo-purchase-send-request.mapper';
import { SiigoAccountMappingService } from './siigo-account-mapping.service';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';
import { SiigoPurchaseService } from './siigo-purchase.service';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';
import { SiigoDocumentSendThrottleService } from './siigo-document-send-throttle.service';

@Injectable()
export class SiigoPurchaseSendService {
  private readonly logger = new Logger(SiigoPurchaseSendService.name);

  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
    private readonly siigoPurchaseService: SiigoPurchaseService,
    private readonly siigoTaxesCatalogService: SiigoTaxesCatalogService,
    private readonly siigoAccountMappingService: SiigoAccountMappingService,
    private readonly siigoDocumentSendThrottleService: SiigoDocumentSendThrottleService,
  ) {}

  async sendPurchase(
    request: CreateSiigoPurchaseSendRequestDto,
    companyId: string,
  ): Promise<CreateSiigoPurchaseSendResponseDto> {
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
              this.siigoPurchaseService.createPurchase(
                accessToken,
                siigoPayload,
                partnerId,
              ),
            SIIGO_DOCUMENT_SEND_RETRY_OPTIONS,
          ),
      );

      const preferenceSnapshot = buildSupplierPreferenceSnapshotFromSendRequest(
        request as unknown as CreateSiigoSupportDocumentRequestDto,
        taxesCatalog,
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

      if (preferenceSnapshot) {
        await this.siigoAccountMappingService.persistSupplierPreferenceSnapshot(
          electronicDocument,
          companyId,
          preferenceSnapshot,
        );
      }

      if (request.savePreferences) {
        await this.persistSupplierPreferencesFromRequest(
          request,
          electronicDocument,
          companyId,
          taxesCatalog,
        );
      }

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

  private async persistSupplierPreferencesFromRequest(
    request: CreateSiigoPurchaseSendRequestDto,
    electronicDocument: Awaited<
      ReturnType<ElectronicDocumentService['requireById']>
    >,
    companyId: string,
    taxesCatalog: Awaited<
      ReturnType<SiigoTaxesCatalogService['listTaxes']>
    >,
  ): Promise<void> {
    const accountCode = request.items[0]?.code?.trim();

    if (!accountCode) {
      return;
    }

    const taxesById = new Map(taxesCatalog.map((tax) => [tax.id, tax]));
    const snapshot = request.supplierPreferences;
    const paymentMethod = snapshot?.paymentMethod ?? {
      id: request.payments[0]?.id,
      name: '',
      type: '',
    };
    const retentions =
      snapshot?.retentions ??
      (request.retentions ?? []).map((retention) => {
        const tax = taxesById.get(retention.id);

        return {
          id: retention.id,
          name: tax?.name ?? `Retención ${retention.id}`,
          type: retention.type ?? tax?.type ?? '',
          percentage: tax?.percentage ?? 0,
        };
      });

    if (!paymentMethod.id) {
      return;
    }

    await this.siigoAccountMappingService.persistSupplierPreferencesForDocument(
      electronicDocument,
      companyId,
      {
        accountCode,
        accountDescription:
          snapshot?.accountDescription?.trim() || accountCode,
        paymentMethod: {
          id: paymentMethod.id,
          name: paymentMethod.name?.trim() || `Medio ${paymentMethod.id}`,
          type: paymentMethod.type?.trim() || '',
          ...(paymentMethod.dueDate === undefined
            ? {}
            : { dueDate: paymentMethod.dueDate }),
        },
        retentions,
        ...(snapshot?.costCenter
          ? {
              costCenter: {
                id: snapshot.costCenter.id,
                code: snapshot.costCenter.code,
                name: snapshot.costCenter.name,
              },
            }
          : request.cost_center !== undefined
            ? {
                costCenter: {
                  id: request.cost_center,
                  code: String(request.cost_center),
                  name: `Centro ${request.cost_center}`,
                },
              }
            : {}),
      },
    );
  }
}
