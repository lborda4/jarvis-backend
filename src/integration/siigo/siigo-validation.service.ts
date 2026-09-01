import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentProcessingStatus } from '../../electronic-document/enums/electronic-document-processing-status.enum';
import { resolveSupplierDocumentFromPayload } from '../../electronic-document/helpers/electronic-document-supplier.helper';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { SIIGO_DEFAULT_ITEM_TYPE } from './constants/supplier-configuration.constants';
import {
  ValidateSiigoImportRequestDto,
  ValidateSiigoImportResponseDto,
} from './dto/validate-siigo-import.dto';
import { SiigoImportValidationStatus } from './enums/siigo-import-validation-status.enum';
import {
  isSiigoRateLimitError,
  isSiigoUnauthorizedError,
  sleep,
} from './helpers/siigo-auth.helper';
import {
  getSiigoIntegration,
  normalizeSupplierDocument,
} from './helpers/siigo-context.helper';
import { handleSiigoApiError } from './helpers/siigo-error.helper';
import { buildSiigoImportResponse } from './helpers/siigo-import-response.helper';
import { getSiigoSupplierName } from './helpers/siigo-supplier.helper';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoSupplierService } from './siigo-supplier.service';
import { SiigoCustomer } from './interfaces/siigo-api.interface';
import { SiigoBatchContext } from './interfaces/siigo-batch-context.interface';
import { SiigoAuthContext } from './interfaces/siigo-auth-context.interface';

@Injectable()
export class SiigoValidationService {
  private readonly logger = new Logger(SiigoValidationService.name);

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoSupplierService: SiigoSupplierService,
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
  ) {}

  async validateImport(
    request: ValidateSiigoImportRequestDto,
    companyId: string,
    batchContext?: SiigoBatchContext,
    options?: { skipNotFoundStatusWrite?: boolean },
  ): Promise<ValidateSiigoImportResponseDto> {
    const documentId = request?.documentId?.trim();

    try {
      const electronicDocument =
        await this.electronicDocumentService.requireById(documentId, companyId);
      const supplier = resolveSupplierDocumentFromPayload(
        electronicDocument.payload,
      );

      if (!supplier.normalizedDocumentNumber) {
        throw new BadRequestException(
          'El documento electrónico no contiene un número de proveedor válido en el payload.',
        );
      }

      const nit = supplier.normalizedDocumentNumber;
      const documentType =
        electronicDocument.payload.supplier.documentType?.trim() || 'NIT';

      // 1) BD local primero (sin llamar a SIIGO).
      const localName =
        batchContext?.localSupplierNamesByNit.get(nit)?.trim() ||
        (await this.findLocalSupplierName(companyId, nit));

      if (localName) {
        batchContext?.localSupplierNamesByNit.set(nit, localName);
        await this.applyResolvedSupplierName(
          documentId,
          electronicDocument.payload,
          localName,
          companyId,
        );

        return buildSiigoImportResponse({
          status: SiigoImportValidationStatus.ACCOUNT_REQUIRED,
          supplierDocument: nit,
          supplierName: localName,
        });
      }

      // 2) Consultar SIIGO (dedupe por NIT en el batch).
      const branchOffice = 0;
      const siigoSupplier = await this.findSupplierInSiigo(
        documentId,
        nit,
        branchOffice,
        companyId,
        batchContext,
      );

      if (!siigoSupplier) {
        // El llamador puede pedir NO marcar SUPPLIER_NOT_FOUND todavía (ej.
        // preparación en segundo plano, que va a intentar crear el tercero
        // automático a continuación) — evita que la fila parpadee a "Crear
        // tercero" en el frontend un instante antes de resolverse sola.
        if (!options?.skipNotFoundStatusWrite) {
          await this.electronicDocumentService.updateStatus(
            documentId,
            ElectronicDocumentStatus.SUPPLIER_NOT_FOUND,
            companyId,
          );
        }

        return buildSiigoImportResponse({
          status: SiigoImportValidationStatus.THIRD_PARTY_REQUIRED,
          supplierDocument: nit,
          supplierName: electronicDocument.payload.supplier.name || null,
        });
      }

      const supplierName =
        getSiigoSupplierName(siigoSupplier) || `Proveedor ${nit}`;

      // 3) Guardar/actualizar tercero en BD y reflejar nombre en el documento.
      await this.upsertLocalSupplier(
        companyId,
        nit,
        documentType,
        supplierName,
      );
      batchContext?.localSupplierNamesByNit.set(nit, supplierName);

      await this.applyResolvedSupplierName(
        documentId,
        electronicDocument.payload,
        supplierName,
        companyId,
      );

      return buildSiigoImportResponse({
        status: SiigoImportValidationStatus.ACCOUNT_REQUIRED,
        supplierDocument: nit,
        supplierName,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        `[documentId=${documentId}] Error al validar proveedor en SIIGO`,
        error instanceof Error ? error.stack : String(error),
      );

      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException(
        error instanceof Error
          ? error.message
          : 'Error inesperado al validar proveedor en SIIGO',
      );
    }
  }

  private async findLocalSupplierName(
    companyId: string,
    nit: string,
  ): Promise<string | null> {
    try {
      const integration = await getSiigoIntegration(
        this.integrationsRepository,
        companyId,
      );
      const configuration =
        await this.supplierConfigurationsRepository.findByCompanyIntegrationAndNormalizedSupplierDocument(
          companyId,
          integration.id,
          nit,
        );

      return configuration?.supplierName?.trim() || null;
    } catch {
      return null;
    }
  }

  private async upsertLocalSupplier(
    companyId: string,
    nit: string,
    documentType: string,
    supplierName: string,
  ): Promise<void> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const existing =
      await this.supplierConfigurationsRepository.findByCompanyIntegrationAndNormalizedSupplierDocument(
        companyId,
        integration.id,
        nit,
      );

    if (existing) {
      existing.supplierName = supplierName;
      existing.supplierDocument = normalizeSupplierDocument(nit);
      existing.supplierDocumentType = documentType;
      await this.supplierConfigurationsRepository.save(existing);
      return;
    }

    await this.supplierConfigurationsRepository.save(
      this.supplierConfigurationsRepository.create({
        companyId,
        integrationId: integration.id,
        supplierDocument: normalizeSupplierDocument(nit),
        supplierDocumentType: documentType,
        supplierName,
        itemType: SIIGO_DEFAULT_ITEM_TYPE,
      }),
    );
  }

  private async applyResolvedSupplierName(
    documentId: string,
    payload: Awaited<
      ReturnType<ElectronicDocumentService['requireById']>
    >['payload'],
    supplierName: string,
    companyId: string,
  ): Promise<void> {
    await this.electronicDocumentService.updatePayloadAndStatus(
      documentId,
      {
        ...payload,
        supplier: {
          ...payload.supplier,
          name: supplierName,
          commercialName: supplierName,
        },
      },
      ElectronicDocumentStatus.ACCOUNT_REQUIRED,
      companyId,
    );
    await this.electronicDocumentService.updateProcessingMetadata(
      documentId,
      {
        supplierExistsInSiigo: true,
        processingStatus: ElectronicDocumentProcessingStatus.ACCOUNT_REQUIRED,
      },
      companyId,
    );
  }

  private async findSupplierInSiigo(
    documentId: string,
    supplierDocument: string,
    branchOffice: number,
    companyId: string,
    batchContext?: SiigoBatchContext,
  ): Promise<SiigoCustomer | null> {
    if (batchContext?.supplierByNit.has(supplierDocument)) {
      return batchContext.supplierByNit.get(supplierDocument) ?? null;
    }

    const inFlightRequest =
      batchContext?.supplierRequestsInFlight.get(supplierDocument);
    if (inFlightRequest) {
      return inFlightRequest;
    }

    const authContext =
      batchContext?.authContext ??
      (await this.siigoAuthService.getValidAuthContext(companyId));

    const supplierRequest = this.querySupplierWithRetries(
      documentId,
      authContext,
      supplierDocument,
      branchOffice,
      companyId,
      0,
      batchContext,
    ).then((result) => {
      batchContext?.supplierByNit.set(supplierDocument, result);
      batchContext?.supplierRequestsInFlight.delete(supplierDocument);
      return result;
    });

    batchContext?.supplierRequestsInFlight.set(
      supplierDocument,
      supplierRequest,
    );

    return supplierRequest;
  }

  private updateBatchAuthContext(
    batchContext: SiigoBatchContext | undefined,
    authContext: SiigoAuthContext,
  ): void {
    if (batchContext) {
      batchContext.authContext = authContext;
    }
  }

  private async querySupplierWithRetries(
    documentId: string,
    authContext: SiigoAuthContext,
    supplierDocument: string,
    branchOffice: number,
    companyId: string,
    attempt = 0,
    batchContext?: SiigoBatchContext,
  ): Promise<SiigoCustomer | null> {
    try {
      return await this.siigoSupplierService.findSupplierByNit(
        authContext.accessToken,
        supplierDocument,
        branchOffice,
        authContext.partnerId,
      );
    } catch (error) {
      this.logger.error(
        `[documentId=${documentId}] Error al consultar tercero en SIIGO`,
        error instanceof Error ? error.stack : String(error),
      );

      if (isSiigoUnauthorizedError(error) && attempt < 1) {
        const refreshedContext =
          await this.siigoAuthService.forceRefreshAuthContext(companyId);

        this.updateBatchAuthContext(batchContext, refreshedContext);

        return this.querySupplierWithRetries(
          documentId,
          refreshedContext,
          supplierDocument,
          branchOffice,
          companyId,
          attempt + 1,
          batchContext,
        );
      }

      if (isSiigoRateLimitError(error) && attempt < 2) {
        await sleep(1500);

        return this.querySupplierWithRetries(
          documentId,
          authContext,
          supplierDocument,
          branchOffice,
          companyId,
          attempt + 1,
          batchContext,
        );
      }

      handleSiigoApiError(this.logger, error, 'consultar tercero');
    }
  }
}
