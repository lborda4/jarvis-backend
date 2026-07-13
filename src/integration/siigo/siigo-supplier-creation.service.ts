import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentProcessingStatus } from '../../electronic-document/enums/electronic-document-processing-status.enum';
import { ElectronicDocument } from '../../electronic-document/entities/electronic-document.entity';
import { resolveSupplierDocumentFromPayload } from '../../electronic-document/helpers/electronic-document-supplier.helper';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import { SIIGO_DEFAULT_ITEM_TYPE } from './constants/supplier-configuration.constants';
import { CreateSiigoSupplierRequestDto } from './dto/create-siigo-supplier-request.dto';
import { CreateSiigoSupplierResponseDto } from './dto/create-siigo-supplier-response.dto';
import { getSiigoIntegration, normalizeSupplierDocument } from './helpers/siigo-context.helper';
import { handleSiigoApiError } from './helpers/siigo-error.helper';
import {
  isSiigoRateLimitError,
  isSiigoUnauthorizedError,
  sleep,
} from './helpers/siigo-auth.helper';
import { getSiigoSupplierName } from './helpers/siigo-supplier.helper';
import { mapElectronicDocumentPayloadToSiigoSupplier } from './mappers/electronic-document-to-siigo-supplier.mapper';
import { mapSiigoCustomerToCreatedSupplierResponse } from './mappers/siigo-customer-to-supplier-response.mapper';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoSupplierService } from './siigo-supplier.service';
import { SiigoCustomer } from './interfaces/siigo-api.interface';
import { SiigoSupplierRequestDto } from './dto/siigo-supplier-request.dto';

@Injectable()
export class SiigoSupplierCreationService {
  private readonly logger = new Logger(SiigoSupplierCreationService.name);

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoSupplierService: SiigoSupplierService,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
    private readonly electronicDocumentService: ElectronicDocumentService,
  ) {}

  async createSupplier(
    request: CreateSiigoSupplierRequestDto,
    companyId: string,
  ): Promise<CreateSiigoSupplierResponseDto> {
    const documentId = request?.documentId?.trim();

    if (!documentId) {
      throw new BadRequestException('El campo documentId es obligatorio.');
    }

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

    this.logger.log(
      `[documentId=${documentId}] Creación de tercero en SIIGO desde payload persistido`,
    );

    const siigoPayload = mapElectronicDocumentPayloadToSiigoSupplier(
      electronicDocument.payload,
    );

    console.log('[SIIGO supplier] ANTES crear tercero', {
      documentId,
      identification: siigoPayload.identification,
      idType: siigoPayload.id_type,
      personType: siigoPayload.person_type,
      name: siigoPayload.name,
      checkDigit: siigoPayload.check_digit ?? null,
      address: siigoPayload.address ?? null,
      phones: siigoPayload.phones ?? null,
    });

    try {
      const branchOffice = 0;
      const existingSupplier = await this.findSupplierInSiigoWithRetries(
        supplier.normalizedDocumentNumber,
        branchOffice,
        companyId,
      );
      const siigoSupplier =
        existingSupplier ??
        (await this.createSupplierInSiigoWithRetries(siigoPayload, companyId));

      if (existingSupplier) {
        this.logger.log(
          `[documentId=${documentId}] Tercero ya existe en SIIGO (nit=${supplier.normalizedDocumentNumber}); se reutiliza sin crear duplicado`,
        );
      } else {
        console.log('[SIIGO supplier] DESPUÉS crear tercero OK', {
          documentId,
          siigoCustomerId: siigoSupplier.id,
        });
      }

      return this.completeSupplierCreation(
        documentId,
        companyId,
        electronicDocument,
        supplier.normalizedDocumentNumber,
        siigoSupplier,
      );
    } catch (error) {
      this.logger.error(
        `[documentId=${documentId}] Error al crear tercero en SIIGO`,
        error instanceof Error ? error.stack : String(error),
      );

      console.error('[SIIGO supplier] error crear tercero', {
        documentId,
        message: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException(
        error instanceof Error
          ? error.message
          : 'Error inesperado al crear tercero en SIIGO',
      );
    }
  }

  private async completeSupplierCreation(
    documentId: string,
    companyId: string,
    electronicDocument: ElectronicDocument,
    normalizedDocumentNumber: string,
    siigoSupplier: SiigoCustomer,
  ): Promise<CreateSiigoSupplierResponseDto> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const supplierName =
      getSiigoSupplierName(siigoSupplier) ||
      electronicDocument.payload.supplier.name ||
      `Proveedor ${normalizedDocumentNumber}`;

    await this.createSupplierConfiguration(
      electronicDocument.companyId,
      integration.id,
      normalizedDocumentNumber,
      supplierName,
      electronicDocument.payload.supplier.documentType || 'NIT',
    );

    await this.electronicDocumentService.updateStatus(
      documentId,
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

    return {
      success: true,
      supplier: mapSiigoCustomerToCreatedSupplierResponse(
        siigoSupplier,
        electronicDocument.payload,
      ),
    };
  }

  private async findSupplierInSiigoWithRetries(
    supplierDocument: string,
    branchOffice: number,
    companyId: string,
    attempt = 0,
  ): Promise<SiigoCustomer | null> {
    let authContext = await this.siigoAuthService.getValidAuthContext(companyId);

    try {
      return await this.siigoSupplierService.findSupplierByNit(
        authContext.accessToken,
        supplierDocument,
        branchOffice,
        authContext.partnerId,
      );
    } catch (error) {
      if (isSiigoUnauthorizedError(error) && attempt < 1) {
        authContext = await this.siigoAuthService.forceRefreshAuthContext(companyId);

        return this.findSupplierInSiigoWithRetries(
          supplierDocument,
          branchOffice,
          companyId,
          attempt + 1,
        );
      }

      if (isSiigoRateLimitError(error) && attempt < 2) {
        await sleep(1500);

        return this.findSupplierInSiigoWithRetries(
          supplierDocument,
          branchOffice,
          companyId,
          attempt + 1,
        );
      }

      handleSiigoApiError(this.logger, error, 'consultar tercero');
    }
  }

  private async createSupplierInSiigoWithRetries(
    payload: SiigoSupplierRequestDto,
    companyId: string,
    attempt = 0,
  ): Promise<SiigoCustomer> {
    let authContext = await this.siigoAuthService.getValidAuthContext(companyId);

    try {
      return await this.siigoSupplierService.createSupplier(
        authContext.accessToken,
        payload,
        authContext.partnerId,
      );
    } catch (error) {
      if (isSiigoUnauthorizedError(error) && attempt < 1) {
        authContext = await this.siigoAuthService.forceRefreshAuthContext(companyId);

        return this.createSupplierInSiigoWithRetries(payload, companyId, attempt + 1);
      }

      if (isSiigoRateLimitError(error) && attempt < 2) {
        await sleep(1500);

        return this.createSupplierInSiigoWithRetries(payload, companyId, attempt + 1);
      }

      handleSiigoApiError(this.logger, error, 'crear tercero');
    }
  }

  private async createSupplierConfiguration(
    companyId: string,
    integrationId: string,
    supplierDocument: string,
    supplierName: string,
    supplierDocumentType: string,
  ): Promise<SupplierConfiguration> {
    const existing =
      await this.supplierConfigurationsRepository.findByCompanyIntegrationAndNormalizedSupplierDocument(
        companyId,
        integrationId,
        supplierDocument,
      );

    if (existing) {
      existing.supplierName = supplierName;
      existing.supplierDocument = normalizeSupplierDocument(supplierDocument);
      existing.supplierDocumentType = supplierDocumentType;
      return this.supplierConfigurationsRepository.save(existing);
    }

    const configuration = this.supplierConfigurationsRepository.create({
      companyId,
      integrationId,
      supplierDocument: normalizeSupplierDocument(supplierDocument),
      supplierDocumentType,
      supplierName,
      itemType: SIIGO_DEFAULT_ITEM_TYPE,
      mappingValue: null,
      autoApply: false,
    });

    return this.supplierConfigurationsRepository.save(configuration);
  }
}
