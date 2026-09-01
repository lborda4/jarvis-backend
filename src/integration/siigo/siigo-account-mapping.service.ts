import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import {
  applyAccountMappingToPayload,
  applyPerItemAccountMappingToPayload,
} from '../../electronic-document/helpers/electronic-document-account-mapping.helper';
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
import {
  normalizeSupplierPreferenceSnapshot,
  resolveSuggestedAccountForItem,
} from '../helpers/supplier-preference.helper';
import { normalizeItemDescription } from '../helpers/supplier-item-account-mapping.helper';
import {
  buildAccountNameByCode,
  resolveAccountNameFromCatalog,
} from '../helpers/supplier-accounts-catalog.helper';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SiigoAccountsRepository } from '../repositories/siigo-accounts.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { SupplierItemAccountMappingsRepository } from '../repositories/supplier-item-account-mappings.repository';
import { SIIGO_DEFAULT_ITEM_TYPE } from './constants/supplier-configuration.constants';
import {
  SaveAccountMappingItemDto,
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
import {
  AccountMappingRuleSupplierDto,
  ListAccountMappingRulesResponseDto,
  UpdateAccountMappingRuleRequestDto,
  UpdateAccountMappingRuleResponseDto,
} from './dto/account-mapping-rules.dto';
import { getSiigoIntegration } from './helpers/siigo-context.helper';

const ACCOUNT_MAPPING_REQUIRED_STATUS = 'ACCOUNT_MAPPING_REQUIRED';
const ACCOUNT_MAPPED_STATUS = 'ACCOUNT_MAPPED';

@Injectable()
export class SiigoAccountMappingService {
  private readonly logger = new Logger(SiigoAccountMappingService.name);

  constructor(
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
    private readonly supplierItemAccountMappingsRepository: SupplierItemAccountMappingsRepository,
    private readonly siigoAccountsRepository: SiigoAccountsRepository,
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly integrationsRepository: IntegrationsRepository,
  ) {}

  /**
   * Auto-aplica una cuenta ya conocida sin intervención del contador — a
   * propósito, solo cuando TODOS los ítems del documento tienen una regla
   * exacta confirmada (proveedor + descripción). Un ítem que solo resuelve
   * por fallback de proveedor (descripción nueva) no cuenta como
   * confirmado: se prefiere pedir revisión manual antes que aplicar en
   * silencio una sugerencia no verificada.
   */
  async validateAccountMapping(
    request: ValidateAccountMappingRequestDto,
    companyId: string,
  ): Promise<ValidateAccountMappingResponseDto> {
    const documentId = this.requireDocumentId(request.documentId);
    const electronicDocument = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );
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

    const items = electronicDocument.payload.items ?? [];

    if (items.length === 0) {
      // Documento sin ítems (caso borde): cae al fallback de proveedor de
      // siempre, no hay descripción de la que colgar una regla específica.
      const accountCode =
        normalizeSupplierPreferenceSnapshot(configuration?.preference)?.account
          .code ?? null;

      if (!accountCode?.trim()) {
        return { status: ACCOUNT_MAPPING_REQUIRED_STATUS };
      }

      const updatedPayload = applyAccountMappingToPayload(
        electronicDocument.payload,
        accountCode,
      );
      const updatedDocument =
        await this.electronicDocumentService.updatePayloadAndStatus(
          documentId,
          updatedPayload,
          ElectronicDocumentStatus.ACCOUNT_MAPPED,
          companyId,
        );

      return {
        status: ACCOUNT_MAPPED_STATUS,
        accountCode,
        document: mapElectronicDocumentToResponse(updatedDocument),
      };
    }

    const accountByDescription = new Map<
      string,
      { code: string; description?: string }
    >();

    for (const item of items) {
      const itemMapping =
        await this.supplierItemAccountMappingsRepository.findOneByKey(
          electronicDocument.companyId,
          integration.id,
          documentType,
          supplier.normalizedDocumentNumber,
          item.descripcion,
        );
      const resolved = resolveSuggestedAccountForItem(
        itemMapping,
        configuration,
      );

      if (!resolved || resolved.source !== 'exact') {
        this.logger.log(
          `[documentId=${documentId}] Ítem "${item.descripcion}" sin regla confirmada — requiere asignación manual`,
        );

        return { status: ACCOUNT_MAPPING_REQUIRED_STATUS };
      }

      accountByDescription.set(normalizeItemDescription(item.descripcion), {
        code: resolved.code,
        description: resolved.name,
      });
    }

    const distinctCodes = new Set(
      [...accountByDescription.values()].map((value) => value.code),
    );
    const singleAccount =
      distinctCodes.size === 1 ? [...accountByDescription.values()][0] : null;

    const updatedPayload = applyPerItemAccountMappingToPayload(
      electronicDocument.payload,
      accountByDescription,
    );
    const updatedDocument =
      await this.electronicDocumentService.updatePayloadAndStatus(
        documentId,
        updatedPayload,
        ElectronicDocumentStatus.ACCOUNT_MAPPED,
        companyId,
      );

    this.logger.log(
      `[documentId=${documentId}] Cuenta contable aplicada por ítem desde reglas existentes` +
        (singleAccount ? ` (${singleAccount.code})` : ' (varias cuentas)'),
    );

    return {
      status: ACCOUNT_MAPPED_STATUS,
      ...(singleAccount
        ? {
            accountCode: singleAccount.code,
            accountDescription: singleAccount.description,
          }
        : {}),
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
    const electronicDocument = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );

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

    const accountByDescription =
      await this.persistSupplierItemAccountMappingsForDocument(
        electronicDocument,
        companyId,
        request.items,
        accountCode,
        accountDescription,
      );

    const updatedPayload = applyPerItemAccountMappingToPayload(
      electronicDocument.payload,
      accountByDescription,
    );
    const updatedDocument =
      await this.electronicDocumentService.updatePayloadAndStatus(
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

  /**
   * Persiste la regla de cuenta a nivel (proveedor + descripción) para
   * cada ítem del documento, y devuelve el mapa listo para
   * applyPerItemAccountMappingToPayload. Si `items` viene (el contador
   * corrigió cuentas distintas por ítem), se usa tal cual. Si no viene
   * (llamador de un solo concepto, ej. Documento Soporte), se aplica
   * `fallbackAccountCode` a cada descripción distinta presente en el
   * documento — así ese flujo simple ya empieza a poblar la tabla nueva
   * sin necesitar cambiar su UI.
   */
  private async persistSupplierItemAccountMappingsForDocument(
    electronicDocument: ElectronicDocument,
    companyId: string,
    items: SaveAccountMappingItemDto[] | undefined,
    fallbackAccountCode: string,
    fallbackAccountDescription: string,
  ): Promise<Map<string, { code: string; description?: string }>> {
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

    const entries: Array<{
      descripcion: string;
      accountCode: string;
      accountDescription?: string;
    }> =
      items && items.length > 0
        ? items
        : (electronicDocument.payload.items ?? []).map((item) => ({
            descripcion: item.descripcion,
            accountCode: fallbackAccountCode,
            accountDescription: fallbackAccountDescription,
          }));

    const accountByDescription = new Map<
      string,
      { code: string; description?: string }
    >();

    for (const entry of entries) {
      if (!entry.descripcion?.trim() || !entry.accountCode?.trim()) {
        continue;
      }

      await this.supplierItemAccountMappingsRepository.upsertConfirmedAccount({
        companyId: electronicDocument.companyId,
        integrationId: integration.id,
        supplierDocumentType: documentType,
        supplierDocument: supplier.normalizedDocumentNumber,
        description: entry.descripcion,
        accountCode: entry.accountCode,
        accountName: entry.accountDescription,
      });

      accountByDescription.set(normalizeItemDescription(entry.descripcion), {
        code: entry.accountCode,
        description: entry.accountDescription,
      });
    }

    return accountByDescription;
  }

  /**
   * Reglas de mapeo por proveedor para la pantalla de administración —
   * solo lista proveedores que ya tienen al menos una regla a nivel ítem
   * (de una confirmación manual o del backfill de historial); un proveedor
   * que solo tiene el fallback viejo de SupplierConfiguration.preference
   * (sin ninguna descripción confirmada todavía) no aparece acá.
   */
  async listAccountMappingRules(
    companyId: string,
  ): Promise<ListAccountMappingRulesResponseDto> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    const [itemMappings, configurations, siigoAccounts] = await Promise.all([
      this.supplierItemAccountMappingsRepository.findByCompanyAndIntegration(
        companyId,
        integration.id,
      ),
      this.supplierConfigurationsRepository.findByCompanyAndIntegration(
        companyId,
        integration.id,
      ),
      this.siigoAccountsRepository.findByCompanyAndIntegration(
        companyId,
        integration.id,
      ),
    ]);

    // El nombre guardado en supplier_item_account_mappings puede venir de
    // una fuente que solo conocía el código (ej. el backfill de historial,
    // o una regla nunca confirmada a mano) — el catálogo real de SIIGO
    // SIEMPRE tiene la última palabra sobre el nombre mostrado.
    const accountNameByCode = buildAccountNameByCode(siigoAccounts);

    const supplierNameByDocument = new Map(
      configurations.map((configuration) => [
        configuration.supplierDocument,
        configuration.supplierName,
      ]),
    );

    const itemsBySupplier = new Map<string, typeof itemMappings>();

    for (const mapping of itemMappings) {
      const existing = itemsBySupplier.get(mapping.supplierDocument) ?? [];
      existing.push(mapping);
      itemsBySupplier.set(mapping.supplierDocument, existing);
    }

    const suppliers: AccountMappingRuleSupplierDto[] = [
      ...itemsBySupplier.entries(),
    ].map(([supplierDocument, items]) => {
      const distinctCodes = new Set(items.map((item) => item.accountCode));
      const isSingleAccount = distinctCodes.size === 1;

      return {
        supplierDocument,
        supplierName: supplierNameByDocument.get(supplierDocument) ?? null,
        isSingleAccount,
        ...(isSingleAccount
          ? {
              singleAccount: {
                code: items[0].accountCode,
                name: resolveAccountNameFromCatalog(
                  items[0].accountCode,
                  items[0].accountName,
                  accountNameByCode,
                ),
              },
            }
          : {}),
        items: items
          .map((item) => ({
            descripcion: item.descriptionOriginal,
            accountCode: item.accountCode,
            accountName: resolveAccountNameFromCatalog(
              item.accountCode,
              item.accountName,
              accountNameByCode,
            ),
            confirmationsCount: item.confirmationsCount,
            lastConfirmedAt: item.lastConfirmedAt?.toISOString() ?? null,
          }))
          .sort((left, right) =>
            left.descripcion.localeCompare(right.descripcion),
          ),
      };
    });

    suppliers.sort((left, right) =>
      (left.supplierName ?? left.supplierDocument).localeCompare(
        right.supplierName ?? right.supplierDocument,
      ),
    );

    return { suppliers };
  }

  async updateAccountMappingRule(
    request: UpdateAccountMappingRuleRequestDto,
    companyId: string,
  ): Promise<UpdateAccountMappingRuleResponseDto> {
    const supplierDocument = request.supplierDocument?.trim();
    const descripcion = request.descripcion?.trim();
    const accountCode = request.accountCode?.trim();

    if (!supplierDocument || !descripcion || !accountCode) {
      throw new BadRequestException(
        'supplierDocument, descripcion y accountCode son obligatorios.',
      );
    }

    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    const saved =
      await this.supplierItemAccountMappingsRepository.upsertConfirmedAccount({
        companyId,
        integrationId: integration.id,
        supplierDocumentType: 'NIT',
        supplierDocument,
        description: descripcion,
        accountCode,
        accountName: request.accountName,
      });

    return {
      success: true,
      rule: {
        descripcion: saved.descriptionOriginal,
        accountCode: saved.accountCode,
        accountName: saved.accountName,
        confirmationsCount: saved.confirmationsCount,
        lastConfirmedAt: saved.lastConfirmedAt?.toISOString() ?? null,
      },
    };
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
