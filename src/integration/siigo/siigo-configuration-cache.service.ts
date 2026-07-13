import { Injectable, Logger } from '@nestjs/common';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { IntegrationConfiguration } from '../interfaces/integration-configuration.interface';
import {
  SiigoCachedAccountCatalogItem,
  SiigoCachedPaymentTypeCatalogItem,
  SiigoCachedTaxCatalogItem,
  SiigoCatalogCache,
} from '../interfaces/siigo-catalog-cache.interface';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { collectUniqueAccountsCatalog } from '../helpers/supplier-accounts-catalog.helper';
import { SiigoHttpClient } from './clients/siigo-http.client';
import {
  SIIGO_PAYMENT_DOCUMENT_TYPE_PURCHASE,
  SIIGO_PAYMENT_DOCUMENT_TYPE_SUPPORT,
  SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
  SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
} from './constants/siigo.constants';
import {
  SIIGO_CONFIGURATION_CACHE_LOG,
} from './constants/siigo-configuration-cache.constants';
import { SiigoAccountCatalogItemDto } from './dto/list-siigo-accounts.dto';
import { SiigoPaymentTypeCatalogItemDto } from './dto/list-siigo-payment-types.dto';
import { SiigoTaxCatalogItemDto } from './dto/list-siigo-taxes.dto';
import {
  buildSiigoCatalogCacheTimestamp,
  isSiigoConfigurationFresh,
} from './helpers/siigo-configuration-cache.helper';
import { getSiigoIntegration, resolveSiigoCompany } from './helpers/siigo-context.helper';
import {
  isValidSiigoConfigurationId,
  pickSiigoDocumentTypeId,
} from './helpers/siigo-document-type.helper';
import { SiigoAuthService } from './siigo-auth.service';

const PAYMENT_DOCUMENT_TYPES_TO_SYNC = [
  SIIGO_PAYMENT_DOCUMENT_TYPE_PURCHASE,
  SIIGO_PAYMENT_DOCUMENT_TYPE_SUPPORT,
] as const;

@Injectable()
export class SiigoConfigurationCacheService {
  private readonly logger = new Logger(SiigoConfigurationCacheService.name);
  private readonly syncInProgressByCompany = new Map<string, Promise<void>>();

  constructor(
    private readonly companiesRepository: CompaniesRepository,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoHttpClient: SiigoHttpClient,
  ) {}

  async getAccounts(companyId: string): Promise<SiigoAccountCatalogItemDto[]> {
    const cache = await this.ensureCatalogCache(companyId);

    return cache.accounts ?? [];
  }

  async getPaymentTypes(
    documentType: string,
    companyId: string,
  ): Promise<SiigoPaymentTypeCatalogItemDto[]> {
    const normalizedDocumentType = documentType.trim().toUpperCase();
    const cache = await this.ensureCatalogCache(companyId);

    return cache.paymentTypes?.[normalizedDocumentType] ?? [];
  }

  async getTaxes(
    typeFilter: string | undefined,
    companyId: string,
  ): Promise<SiigoTaxCatalogItemDto[]> {
    const cache = await this.ensureCatalogCache(companyId);
    const taxes = cache.taxes ?? [];
    const normalizedFilter = typeFilter?.trim().toLowerCase();

    if (!normalizedFilter) {
      return taxes;
    }

    return taxes.filter(
      (tax) => tax.type?.trim().toLowerCase() === normalizedFilter,
    );
  }

  async getSupportDocumentTypeId(companyId: string): Promise<number> {
    const integration = await this.ensureConfigurationSynced(companyId);
    const documentTypeId = integration.configuration?.supportDocumentId;

    if (!isValidSiigoConfigurationId(documentTypeId)) {
      throw new Error(
        `No se pudo resolver el id de Documento Soporte para la empresa ${companyId}.`,
      );
    }

    console.log(SIIGO_CONFIGURATION_CACHE_LOG.USING_STORED_SUPPORT_DOCUMENT_TYPE);
    this.logger.log(
      `[companyId=${companyId}] Tipo de documento DS servido desde configuración almacenada (id=${documentTypeId})`,
    );

    return documentTypeId;
  }

  async getPurchaseDocumentTypeId(companyId: string): Promise<number> {
    const integration = await this.ensureConfigurationSynced(companyId);
    const documentTypeId = integration.configuration?.purchaseDocumentId;

    if (!isValidSiigoConfigurationId(documentTypeId)) {
      throw new Error(
        `No se pudo resolver el id de factura de compra para la empresa ${companyId}.`,
      );
    }

    console.log(SIIGO_CONFIGURATION_CACHE_LOG.USING_STORED_PURCHASE_DOCUMENT_TYPE);
    this.logger.log(
      `[companyId=${companyId}] Tipo de documento FC servido desde configuración almacenada (id=${documentTypeId})`,
    );

    return documentTypeId;
  }

  private async ensureConfigurationSynced(companyId: string) {
    await this.ensureCatalogCache(companyId);

    return getSiigoIntegration(this.integrationsRepository, companyId);
  }

  private async ensureCatalogCache(companyId: string): Promise<SiigoCatalogCache> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    if (isSiigoConfigurationFresh(integration.configuration)) {
      console.log(SIIGO_CONFIGURATION_CACHE_LOG.USING_STORED);
      this.logger.log(
        `[companyId=${companyId}] Configuración SIIGO servida desde almacenamiento (lastSync=${integration.configuration?.catalogCache?.lastSync})`,
      );

      return integration.configuration?.catalogCache as SiigoCatalogCache;
    }

    await this.syncCatalogCacheForCompany(companyId);

    const refreshedIntegration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    return refreshedIntegration.configuration?.catalogCache ?? {};
  }

  private async syncCatalogCacheForCompany(companyId: string): Promise<void> {
    const existingSync = this.syncInProgressByCompany.get(companyId);

    if (existingSync) {
      await existingSync;
      return;
    }

    const syncPromise = this.performCatalogSync(companyId).finally(() => {
      this.syncInProgressByCompany.delete(companyId);
    });

    this.syncInProgressByCompany.set(companyId, syncPromise);
    await syncPromise;
  }

  private async performCatalogSync(companyId: string): Promise<void> {
    console.log(SIIGO_CONFIGURATION_CACHE_LOG.EXPIRED_SYNCING);
    this.logger.log(
      `[companyId=${companyId}] Configuración de catálogo SIIGO expirada o inexistente. Sincronizando...`,
    );

    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const company = await resolveSiigoCompany(
      this.companiesRepository,
      companyId,
    );
    const authContext = await this.siigoAuthService.getValidAuthContext(companyId);

    const [accounts, paymentTypes, taxes, supportDocumentId, purchaseDocumentId] =
      await Promise.all([
      this.syncAccountsCatalog(company.id, integration.id),
      this.syncPaymentTypesCatalog(authContext.accessToken, authContext.partnerId),
      this.syncTaxesCatalog(authContext.accessToken, authContext.partnerId),
      this.syncSupportDocumentTypeId(
        authContext.accessToken,
        authContext.partnerId,
      ),
      this.syncPurchaseDocumentTypeId(
        authContext.accessToken,
        authContext.partnerId,
      ),
    ]);

    const nextConfiguration: IntegrationConfiguration = {
      ...integration.configuration,
      supportDocumentId,
      purchaseDocumentId,
      catalogCache: {
        lastSync: buildSiigoCatalogCacheTimestamp(),
        accounts,
        paymentTypes,
        taxes,
      },
    };

    await this.integrationsRepository.updateConfiguration(
      integration,
      nextConfiguration,
    );

    console.log(SIIGO_CONFIGURATION_CACHE_LOG.UPDATED);
    this.logger.log(
      `[companyId=${companyId}] Configuración SIIGO actualizada (accounts=${accounts.length}, taxes=${taxes.length}, paymentTypes=${Object.keys(paymentTypes).join(', ')}, supportDocumentId=${supportDocumentId}, purchaseDocumentId=${purchaseDocumentId})`,
    );
  }

  private async syncSupportDocumentTypeId(
    accessToken: string,
    partnerId?: string,
  ): Promise<number> {
    const documentTypes = await this.siigoHttpClient.listDocumentTypes(
      accessToken,
      SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
      partnerId,
    );

    return pickSiigoDocumentTypeId(
      documentTypes,
      SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
      'Documento Soporte',
    );
  }

  private async syncPurchaseDocumentTypeId(
    accessToken: string,
    partnerId?: string,
  ): Promise<number> {
    const documentTypes = await this.siigoHttpClient.listDocumentTypes(
      accessToken,
      SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
      partnerId,
    );

    return pickSiigoDocumentTypeId(
      documentTypes,
      SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
      'factura de compra',
    );
  }

  private async syncAccountsCatalog(
    companyId: string,
    integrationId: string,
  ): Promise<SiigoCachedAccountCatalogItem[]> {
    const configurations =
      await this.supplierConfigurationsRepository.findByCompanyAndIntegration(
        companyId,
        integrationId,
      );

    return collectUniqueAccountsCatalog(configurations);
  }

  private async syncPaymentTypesCatalog(
    accessToken: string,
    partnerId?: string,
  ): Promise<Record<string, SiigoCachedPaymentTypeCatalogItem[]>> {
    const entries = await Promise.all(
      PAYMENT_DOCUMENT_TYPES_TO_SYNC.map(async (documentType) => {
        const paymentTypes = await this.siigoHttpClient.listPaymentTypes(
          accessToken,
          documentType,
          partnerId,
        );

        const mapped = paymentTypes
          .filter((paymentType) => paymentType.active !== false)
          .map((paymentType) => ({
            id: paymentType.id,
            name: paymentType.name?.trim() || `Medio ${paymentType.id}`,
            type: paymentType.type?.trim() || '',
            dueDate: Boolean(paymentType.due_date),
            documentType,
          }))
          .sort((left, right) => left.name.localeCompare(right.name, 'es'));

        return [documentType, mapped] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  private async syncTaxesCatalog(
    accessToken: string,
    partnerId?: string,
  ): Promise<SiigoCachedTaxCatalogItem[]> {
    const taxes = await this.siigoHttpClient.listTaxes(accessToken, partnerId);

    return taxes
      .filter((tax) => tax.active !== false)
      .map((tax) => ({
        id: tax.id,
        name: tax.name?.trim() || `Impuesto ${tax.id}`,
        type: tax.type?.trim() || '',
        percentage: tax.percentage ?? 0,
        active: tax.active !== false,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'es'));
  }
}
