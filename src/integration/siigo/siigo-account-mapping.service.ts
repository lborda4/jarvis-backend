import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { applyAccountMappingToPayload } from '../../electronic-document/helpers/electronic-document-account-mapping.helper';
import { resolveSupplierDocumentFromPayload } from '../../electronic-document/helpers/electronic-document-supplier.helper';
import { mapElectronicDocumentToResponse } from '../../electronic-document/mappers/electronic-document-response.mapper';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { ElectronicDocument } from '../../electronic-document/entities/electronic-document.entity';
import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import {
  applySupplierPreferencesToMappingValue,
  normalizeSupplierMappingValue,
  normalizeSupplierPaymentMethodPreference,
  normalizeSupplierRetentionPreferences,
} from '../helpers/supplier-mapping-value.helper';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { SIIGO_DEFAULT_ITEM_TYPE } from './constants/supplier-configuration.constants';
import {
  SaveAccountMappingRequestDto,
  SaveAccountMappingResponseDto,
  SaveSupplierPaymentMethodPreferenceDto,
  SaveSupplierRetentionPreferenceDto,
} from './dto/save-account-mapping.dto';
import {
  ValidateAccountMappingRequestDto,
  ValidateAccountMappingResponseDto,
} from './dto/validate-account-mapping.dto';
import { getSiigoIntegration } from './helpers/siigo-context.helper';
import { getPrimarySupplierAccountCode } from '../helpers/supplier-mapping-value.helper';

const ACCOUNT_MAPPING_REQUIRED_STATUS = 'ACCOUNT_MAPPING_REQUIRED';
const ACCOUNT_MAPPED_STATUS = 'ACCOUNT_MAPPED';

@Injectable()
export class SiigoAccountMappingService {
  private readonly logger = new Logger(SiigoAccountMappingService.name);

  constructor(
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly integrationsRepository: IntegrationsRepository,
  ) {}

  async validateAccountMapping(
    request: ValidateAccountMappingRequestDto,
    companyId: string,
  ): Promise<ValidateAccountMappingResponseDto> {
    const documentId = this.requireDocumentId(request.documentId);
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

    const documentType =
      electronicDocument.payload.supplier.documentType?.trim() || 'NIT';
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const configuration =
      await this.supplierConfigurationsRepository.findByCompanyIntegrationAndSupplierIdentity(
        electronicDocument.companyId,
        integration.id,
        documentType,
        supplier.normalizedDocumentNumber,
      );

    const accountCode = getPrimarySupplierAccountCode(configuration?.mappingValue);

    if (!accountCode || !configuration?.autoApply) {
      this.logger.log(
        `[documentId=${documentId}] Proveedor sin cuenta contable auto-aplicable (autoApply=${configuration?.autoApply ?? false})`,
      );

      return {
        status: ACCOUNT_MAPPING_REQUIRED_STATUS,
      };
    }

    const updatedPayload = applyAccountMappingToPayload(
      electronicDocument.payload,
      accountCode,
    );
    const updatedDocument = await this.electronicDocumentService.updatePayloadAndStatus(
      documentId,
      updatedPayload,
      ElectronicDocumentStatus.ACCOUNT_MAPPED,
      companyId,
    );

    this.logger.log(
      `[documentId=${documentId}] Cuenta contable aplicada desde configuración existente (${accountCode})`,
    );

    return {
      status: ACCOUNT_MAPPED_STATUS,
      accountCode,
      document: mapElectronicDocumentToResponse(updatedDocument),
    };
  }

  async saveAccountMapping(
    request: SaveAccountMappingRequestDto,
    companyId: string,
  ): Promise<SaveAccountMappingResponseDto> {
    this.validateSaveRequest(request);

    const documentId = request.documentId.trim();
    const accountCode = request.accountCode.trim();
    const accountDescription = request.accountDescription.trim();
    const autoApply = request.autoApply;
    const electronicDocument =
      await this.electronicDocumentService.requireById(documentId, companyId);

    await this.persistSupplierPreferencesForDocument(
      electronicDocument,
      companyId,
      {
        autoApply,
        accountCode,
        accountDescription,
        paymentMethod: request.paymentMethod,
        retentions: request.retentions,
      },
    );

    const updatedPayload = applyAccountMappingToPayload(
      electronicDocument.payload,
      accountCode,
      accountDescription,
    );
    const updatedDocument = await this.electronicDocumentService.updatePayloadAndStatus(
      documentId,
      updatedPayload,
      ElectronicDocumentStatus.ACCOUNT_MAPPED,
      companyId,
    );

    this.logger.log(
      `[documentId=${documentId}] Preferencias de proveedor guardadas (cuenta=${accountCode}, autoApply=${autoApply}, paymentMethod=${request.paymentMethod?.id ?? 'n/a'}, retentions=${request.retentions?.length ?? 0})`,
    );

    return {
      success: true,
      document: mapElectronicDocumentToResponse(updatedDocument),
    };
  }

  async persistSupplierPreferencesForDocument(
    electronicDocument: ElectronicDocument,
    companyId: string,
    preferences: {
      autoApply: boolean;
      accountCode?: string;
      accountDescription?: string;
      paymentMethod?: SaveSupplierPaymentMethodPreferenceDto | null;
      retentions?: SaveSupplierRetentionPreferenceDto[] | null;
    },
  ): Promise<SupplierConfiguration> {
    const supplier = resolveSupplierDocumentFromPayload(
      electronicDocument.payload,
    );

    if (!supplier.normalizedDocumentNumber) {
      throw new BadRequestException(
        'El documento electrónico no contiene un número de proveedor válido en el payload.',
      );
    }

    const documentType =
      electronicDocument.payload.supplier.documentType?.trim() || 'NIT';
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    let configuration =
      await this.supplierConfigurationsRepository.findByCompanyIntegrationAndNormalizedSupplierDocument(
        electronicDocument.companyId,
        integration.id,
        supplier.normalizedDocumentNumber,
      );

    const normalizedPaymentMethod = preferences.paymentMethod
      ? normalizeSupplierPaymentMethodPreference(preferences.paymentMethod)
      : undefined;
    const normalizedRetentions =
      preferences.retentions !== undefined
        ? normalizeSupplierRetentionPreferences(preferences.retentions)
        : undefined;
    const nextMappingValue = applySupplierPreferencesToMappingValue(
      normalizeSupplierMappingValue(configuration?.mappingValue),
      {
        ...(preferences.accountCode?.trim()
          ? {
              account: {
                code: preferences.accountCode.trim(),
                name:
                  preferences.accountDescription?.trim() ||
                  preferences.accountCode.trim(),
              },
            }
          : {}),
        ...(normalizedPaymentMethod !== undefined
          ? { paymentMethod: normalizedPaymentMethod }
          : {}),
        ...(normalizedRetentions !== undefined
          ? { retentions: normalizedRetentions }
          : {}),
      },
    );

    if (!configuration) {
      configuration = this.supplierConfigurationsRepository.create({
        companyId: electronicDocument.companyId,
        integrationId: integration.id,
        supplierDocument: supplier.normalizedDocumentNumber,
        supplierDocumentType: documentType,
        supplierName: electronicDocument.payload.supplier.name || null,
        itemType: SIIGO_DEFAULT_ITEM_TYPE,
        mappingValue: nextMappingValue,
        autoApply: preferences.autoApply,
      });
    } else {
      configuration.mappingValue = nextMappingValue;
      configuration.autoApply = preferences.autoApply;
      configuration.supplierDocumentType = documentType;
      if (!configuration.supplierName) {
        configuration.supplierName =
          electronicDocument.payload.supplier.name || null;
      }
    }

    return this.supplierConfigurationsRepository.save(configuration);
  }

  private requireDocumentId(documentId?: string): string {
    const trimmed = documentId?.trim();

    if (!trimmed) {
      throw new BadRequestException('El campo documentId es obligatorio.');
    }

    return trimmed;
  }

  private validateSaveRequest(request: SaveAccountMappingRequestDto): void {
    if (!request.documentId?.trim()) {
      throw new BadRequestException('El campo documentId es obligatorio.');
    }

    if (!request.accountCode?.trim()) {
      throw new BadRequestException('El campo accountCode es obligatorio.');
    }

    if (!request.accountDescription?.trim()) {
      throw new BadRequestException(
        'El campo accountDescription es obligatorio.',
      );
    }

    if (request.autoApply === undefined || request.autoApply === null) {
      throw new BadRequestException('El campo autoApply es obligatorio.');
    }
  }
}
