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
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { getSiigoSupplierName } from './helpers/siigo-supplier.helper';
import { mapElectronicDocumentPayloadToSiigoSupplier } from './mappers/electronic-document-to-siigo-supplier.mapper';
import { mapSiigoCustomerToCreatedSupplierResponse } from './mappers/siigo-customer-to-supplier-response.mapper';
import { normalizeSiigoPersonType } from './helpers/siigo-supplier-identity.helper';
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
    const personType = normalizeSiigoPersonType(request?.person_type);

    if (!documentId) {
      throw new BadRequestException('El campo documentId es obligatorio.');
    }

    if (!personType) {
      throw new BadRequestException(
        'Debe indicar si el proveedor es persona natural o persona jurídica.',
      );
    }

    const electronicDocument =
      await this.electronicDocumentService.requireById(documentId, companyId);

    const profileName = request?.name?.trim();
    const profileDocumentNumber = request?.document_number?.trim();
    const profileDocumentType = request?.document_type?.trim();
    const profileCheckDigit = request?.check_digit?.trim();
    const profileEmail = request?.email?.trim();
    const profilePhone = request?.phone?.trim();
    const profileAddress = request?.address?.trim();

    if (
      profileName ||
      profileDocumentNumber ||
      profileDocumentType ||
      profileCheckDigit ||
      profileEmail ||
      profilePhone ||
      profileAddress
    ) {
      await this.electronicDocumentService.updatePayload(
        documentId,
        {
          ...electronicDocument.payload,
          supplier: {
            ...electronicDocument.payload.supplier,
            ...(profileName
              ? { name: profileName, commercialName: profileName }
              : {}),
            ...(profileDocumentNumber
              ? { documentNumber: profileDocumentNumber }
              : {}),
            ...(profileDocumentType
              ? { documentType: profileDocumentType }
              : {}),
            ...(profileCheckDigit ? { checkDigit: profileCheckDigit } : {}),
            ...(profileEmail ? { email: profileEmail } : {}),
            ...(profilePhone ? { phone: profilePhone } : {}),
            ...(profileAddress ? { address: profileAddress } : {}),
          },
        },
        companyId,
      );
    }

    const refreshedDocument =
      await this.electronicDocumentService.requireById(documentId, companyId);
    const supplier = resolveSupplierDocumentFromPayload(
      refreshedDocument.payload,
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
      refreshedDocument.payload,
      personType,
    );

    this.logger.log(
      `[documentId=${documentId}] Creando tercero en SIIGO (identification=${siigoPayload.identification}, idType=${siigoPayload.id_type}, personType=${siigoPayload.person_type})`,
    );

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
        this.logger.log(
          `[documentId=${documentId}] Tercero creado en SIIGO (siigoCustomerId=${siigoSupplier.id})`,
        );
      }

      return this.completeSupplierCreation(
        documentId,
        companyId,
        refreshedDocument,
        supplier.normalizedDocumentNumber,
        siigoSupplier,
      );
    } catch (error) {
      this.logger.error(
        `[documentId=${documentId}] Error al crear tercero en SIIGO`,
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
  ): Promise<SiigoCustomer | null> {
    return executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'consultar tercero',
      (accessToken, partnerId) =>
        this.siigoSupplierService.findSupplierByNit(
          accessToken,
          supplierDocument,
          branchOffice,
          partnerId,
        ),
    );
  }

  private async createSupplierInSiigoWithRetries(
    payload: SiigoSupplierRequestDto,
    companyId: string,
  ): Promise<SiigoCustomer> {
    return executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'crear tercero',
      (accessToken, partnerId) =>
        this.siigoSupplierService.createSupplier(
          accessToken,
          payload,
          partnerId,
        ),
    );
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
    });

    return this.supplierConfigurationsRepository.save(configuration);
  }
}
