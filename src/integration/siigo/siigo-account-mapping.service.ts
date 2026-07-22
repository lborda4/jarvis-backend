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
import { SupplierPreferenceSnapshot } from '../interfaces/supplier-preference.interface';
import {
  normalizeSupplierCostCenterPreference,
  normalizeSupplierPaymentMethodPreference,
  normalizeSupplierRetentionPreferences,
} from '../helpers/supplier-mapping-value.helper';
import { normalizeSupplierPreferenceSnapshot } from '../helpers/supplier-preference.helper';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { SIIGO_DEFAULT_ITEM_TYPE } from './constants/supplier-configuration.constants';
import {
  SaveAccountMappingRequestDto,
  SaveAccountMappingResponseDto,
  SaveSupplierCostCenterPreferenceDto,
  SaveSupplierPaymentMethodPreferenceDto,
  SaveSupplierRetentionPreferenceDto,
} from './dto/save-account-mapping.dto';
import {
  ValidateAccountMappingRequestDto,
  ValidateAccountMappingResponseDto,
} from './dto/validate-account-mapping.dto';
import { getSiigoIntegration } from './helpers/siigo-context.helper';

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

    const accountCode =
      normalizeSupplierPreferenceSnapshot(configuration?.preference)?.account
        .code ?? null;

    if (!accountCode?.trim()) {
      this.logger.log(
        `[documentId=${documentId}] Proveedor sin cuenta contable configurada`,
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
    const electronicDocument =
      await this.electronicDocumentService.requireById(documentId, companyId);

    await this.persistSupplierPreferencesForDocument(
      electronicDocument,
      companyId,
      {
        accountCode,
        accountDescription,
        paymentMethod: request.paymentMethod,
        retentions: request.retentions,
        costCenter: request.costCenter,
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
      `[documentId=${documentId}] Preferencias de proveedor guardadas (cuenta=${accountCode}, paymentMethod=${request.paymentMethod?.id ?? 'n/a'}, retentions=${request.retentions?.length ?? 0})`,
    );

    return {
      success: true,
      document: mapElectronicDocumentToResponse(updatedDocument),
    };
  }

  async persistSupplierPreferenceSnapshot(
    electronicDocument: ElectronicDocument,
    companyId: string,
    preference: SupplierPreferenceSnapshot,
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

    if (!configuration) {
      configuration = this.supplierConfigurationsRepository.create({
        companyId: electronicDocument.companyId,
        integrationId: integration.id,
        supplierDocument: supplier.normalizedDocumentNumber,
        supplierDocumentType: documentType,
        supplierName: electronicDocument.payload.supplier.name || null,
        itemType: SIIGO_DEFAULT_ITEM_TYPE,
      });
    } else {
      configuration.supplierDocumentType = documentType;

      if (!configuration.supplierName) {
        configuration.supplierName =
          electronicDocument.payload.supplier.name || null;
      }
    }

    configuration.preference = preference;

    return this.supplierConfigurationsRepository.save(configuration);
  }

  async persistSupplierPreferencesForDocument(
    electronicDocument: ElectronicDocument,
    companyId: string,
    preferences: {
      accountCode?: string;
      accountDescription?: string;
      paymentMethod?: SaveSupplierPaymentMethodPreferenceDto | null;
      retentions?: SaveSupplierRetentionPreferenceDto[] | null;
      costCenter?: SaveSupplierCostCenterPreferenceDto | null;
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

    const existingSnapshot = normalizeSupplierPreferenceSnapshot(
      configuration?.preference,
    );
    const normalizedPaymentMethod =
      preferences.paymentMethod !== undefined
        ? normalizeSupplierPaymentMethodPreference(preferences.paymentMethod)
        : undefined;
    const normalizedRetentions =
      preferences.retentions !== undefined
        ? normalizeSupplierRetentionPreferences(preferences.retentions)
        : undefined;
    const normalizedCostCenter =
      preferences.costCenter !== undefined
        ? normalizeSupplierCostCenterPreference(preferences.costCenter)
        : undefined;

    const accountCode =
      preferences.accountCode?.trim() ?? existingSnapshot?.account.code;

    if (!accountCode) {
      throw new BadRequestException(
        'No se pudo determinar la cuenta contable del proveedor.',
      );
    }

    const nextPreference: SupplierPreferenceSnapshot = {
      account: {
        code: accountCode,
        name:
          preferences.accountDescription?.trim() ||
          existingSnapshot?.account.name ||
          accountCode,
      },
      retentions:
        normalizedRetentions !== undefined
          ? normalizedRetentions
          : (existingSnapshot?.retentions ?? []),
      ...(normalizedPaymentMethod !== undefined
        ? { paymentMethod: normalizedPaymentMethod }
        : existingSnapshot?.paymentMethod !== undefined
          ? { paymentMethod: existingSnapshot.paymentMethod }
          : {}),
      ...(normalizedCostCenter !== undefined
        ? { costCenter: normalizedCostCenter }
        : existingSnapshot?.costCenter !== undefined
          ? { costCenter: existingSnapshot.costCenter }
          : {}),
    };

    if (!configuration) {
      configuration = this.supplierConfigurationsRepository.create({
        companyId: electronicDocument.companyId,
        integrationId: integration.id,
        supplierDocument: supplier.normalizedDocumentNumber,
        supplierDocumentType: documentType,
        supplierName: electronicDocument.payload.supplier.name || null,
        itemType: SIIGO_DEFAULT_ITEM_TYPE,
      });
    } else {
      configuration.supplierDocumentType = documentType;

      if (!configuration.supplierName) {
        configuration.supplierName =
          electronicDocument.payload.supplier.name || null;
      }
    }

    configuration.preference = nextPreference;

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
  }
}
