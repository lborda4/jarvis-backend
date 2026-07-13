import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { ElectronicDocumentProcessingStatus } from '../../electronic-document/enums/electronic-document-processing-status.enum';
import { resolveSupplierDocumentFromPayload } from '../../electronic-document/helpers/electronic-document-supplier.helper';
import { mapElectronicDocumentToResponse } from '../../electronic-document/mappers/electronic-document-response.mapper';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import {
  CreateSiigoSupportDocumentRequestDto,
  CreateSiigoSupportDocumentResponseDto,
} from './dto/create-siigo-support-document.dto';
import { SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED } from './constants/siigo.constants';
import { getSiigoIntegration } from './helpers/siigo-context.helper';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { mapCreateSupportDocumentRequestToSiigo } from './mappers/create-siigo-support-document-request.mapper';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoDocumentTypesService } from './siigo-document-types.service';
import { SiigoSupportDocumentService } from './siigo-support-document.service';
import { SiigoSupplierService } from './siigo-supplier.service';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';
import { validateSupportDocumentRetentions } from './helpers/siigo-support-document-retention.helper';
import { SiigoAccountMappingService } from './siigo-account-mapping.service';

@Injectable()
export class SiigoSupportDocumentSendService {
  private readonly logger = new Logger(SiigoSupportDocumentSendService.name);

  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoDocumentTypesService: SiigoDocumentTypesService,
    private readonly siigoSupportDocumentService: SiigoSupportDocumentService,
    private readonly siigoSupplierService: SiigoSupplierService,
    private readonly siigoTaxesCatalogService: SiigoTaxesCatalogService,
    private readonly siigoAccountMappingService: SiigoAccountMappingService,
  ) {}

  async sendSupportDocument(
    request: CreateSiigoSupportDocumentRequestDto,
    companyId: string,
  ): Promise<CreateSiigoSupportDocumentResponseDto> {
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

    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const sendStamp =
      integration.configuration?.supportDocumentSendStamp ??
      SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED;
    const taxesCatalog = await this.siigoTaxesCatalogService.listTaxes(
      {},
      companyId,
    );
    const validatedRetentions = validateSupportDocumentRetentions(
      (request.retentions ?? []).map((retention) => retention.id),
      taxesCatalog,
    );
    const siigoPayload = mapCreateSupportDocumentRequestToSiigo(
      {
        ...request,
        retentions: validatedRetentions,
      },
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

    await this.ensureSupplierExistsInSiigo(electronicDocument, companyId);

    const siigoDocumentTypeId =
      await this.siigoDocumentTypesService.resolveSupportDocumentTypeId(
        companyId,
      );
    siigoPayload.document.id = siigoDocumentTypeId;

    try {
      const createdSupportDocument = await executeSiigoRequestWithRetries(
        this.siigoAuthService,
        companyId,
        this.logger,
        'crear Documento Soporte',
        async (accessToken, partnerId) =>
          this.siigoSupportDocumentService.createSupportDocument(
            accessToken,
            siigoPayload,
            partnerId,
          ),
      );

      const updatedDocument =
        await this.electronicDocumentService.markPurchaseCreated(
          documentId,
          createdSupportDocument.id,
          companyId,
        );

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

  private async persistSupplierPreferencesFromRequest(
    request: CreateSiigoSupportDocumentRequestDto,
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
        autoApply: true,
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
      },
    );

    this.logger.log(
      `[documentId=${request.documentId}] Preferencias de proveedor guardadas tras envío exitoso`,
    );
  }

  private async ensureSupplierExistsInSiigo(
    electronicDocument: Awaited<
      ReturnType<ElectronicDocumentService['requireById']>
    >,
    companyId: string,
  ): Promise<void> {
    const supplier = resolveSupplierDocumentFromPayload(
      electronicDocument.payload,
    );

    if (!supplier.normalizedDocumentNumber) {
      throw new BadRequestException(
        'El documento no contiene un número de proveedor válido.',
      );
    }

    const siigoSupplier = await executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'consultar proveedor para Documento Soporte',
      (accessToken, partnerId) =>
        this.siigoSupplierService.findSupplierByNit(
          accessToken,
          supplier.normalizedDocumentNumber,
          0,
          partnerId,
        ),
    );

    if (!siigoSupplier) {
      await this.electronicDocumentService.updateStatus(
        electronicDocument.id,
        ElectronicDocumentStatus.SUPPLIER_NOT_FOUND,
        companyId,
      );
      await this.electronicDocumentService.updateProcessingMetadata(
        electronicDocument.id,
        {
          supplierExistsInSiigo: false,
          processingStatus: ElectronicDocumentProcessingStatus.SUPPLIER_REQUIRED,
        },
        companyId,
      );

      throw new BadRequestException(
        `El proveedor con identificación ${supplier.normalizedDocumentNumber} no existe en SIIGO. Créelo antes de enviar el Documento Soporte.`,
      );
    }

    if (electronicDocument.supplierExistsInSiigo !== true) {
      await this.electronicDocumentService.updateProcessingMetadata(
        electronicDocument.id,
        {
          supplierExistsInSiigo: true,
        },
        companyId,
      );
    }
  }
}
