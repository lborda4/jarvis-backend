import { Injectable, Logger } from '@nestjs/common';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import {
  SiigoCachedAccountCatalogItem,
  SiigoCachedPaymentTypeCatalogItem,
  SiigoCachedTaxCatalogItem,
  SiigoCatalogCache,
} from '../interfaces/siigo-catalog-cache.interface';
import { SiigoCompanyMemoryCache } from '../interfaces/siigo-company-memory-cache.interface';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SiigoAccountsRepository } from '../repositories/siigo-accounts.repository';
import { collectUniqueAccountsCatalog } from '../helpers/supplier-accounts-catalog.helper';
import { SiigoHttpClient } from './clients/siigo-http.client';
import {
  SIIGO_PAYMENT_DOCUMENT_TYPE_PURCHASE,
  SIIGO_PAYMENT_DOCUMENT_TYPE_SUPPORT,
  SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
  SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
} from './constants/siigo.constants';
import { SiigoAccountCatalogItemDto } from './dto/list-siigo-accounts.dto';
import { SiigoPaymentTypeCatalogItemDto } from './dto/list-siigo-payment-types.dto';
import { SiigoTaxCatalogItemDto } from './dto/list-siigo-taxes.dto';
import {
  buildSiigoCatalogCacheTimestamp,
  hasUsableSiigoCatalogCache,
  isSiigoMemoryCacheFresh,
} from './helpers/siigo-configuration-cache.helper';
import {
  buildSiigoPurchaseConfig,
  buildSiigoSupportDocumentConfig,
  SiigoPurchaseConfig,
  SiigoSupportDocumentConfig,
} from './helpers/siigo-runtime-config.helper';
import { getSiigoIntegration, resolveSiigoCompany } from './helpers/siigo-context.helper';
import {
  isValidSiigoConfigurationId,
  pickSiigoDocumentTypeId,
} from './helpers/siigo-document-type.helper';
import { normalizeSiigoCredentials } from './helpers/siigo-credentials.helper';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoAccountsBalanceSyncService } from './siigo-accounts-balance-sync.service';

const PAYMENT_DOCUMENT_TYPES_TO_SYNC = [
  SIIGO_PAYMENT_DOCUMENT_TYPE_PURCHASE,
  SIIGO_PAYMENT_DOCUMENT_TYPE_SUPPORT,
] as const;

@Injectable()
export class SiigoConfigurationCacheService {
  private readonly logger = new Logger(SiigoConfigurationCacheService.name);
  private readonly memoryCacheByCompany = new Map<string, SiigoCompanyMemoryCache>();
  private readonly syncInProgressByCompany = new Map<string, Promise<SiigoCompanyMemoryCache>>();

  constructor(
    private readonly companiesRepository: CompaniesRepository,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly siigoAccountsRepository: SiigoAccountsRepository,
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoHttpClient: SiigoHttpClient,
    private readonly siigoAccountsBalanceSyncService: SiigoAccountsBalanceSyncService,
  ) {}

  async getAccounts(companyId: string): Promise<SiigoAccountCatalogItemDto[]> {
    return this.loadAccountsFromDatabase(companyId);
  }

  async syncCatalogs(companyId: string): Promise<void> {
    await this.syncCompanyCache(companyId);
  }

  async getPaymentTypes(
    documentType: string,
    companyId: string,
  ): Promise<SiigoPaymentTypeCatalogItemDto[]> {
    const normalizedDocumentType = documentType.trim().toUpperCase();
    const cache = await this.ensureCompanyCache(companyId);

    return cache.catalog.paymentTypes?.[normalizedDocumentType] ?? [];
  }

  async getTaxes(
    typeFilter: string | undefined,
    companyId: string,
  ): Promise<SiigoTaxCatalogItemDto[]> {
    const cache = await this.ensureCompanyCache(companyId);
    const taxes = cache.catalog.taxes ?? [];
    const normalizedFilter = typeFilter?.trim().toLowerCase();

    if (!normalizedFilter) {
      return taxes;
    }

    return taxes.filter(
      (tax) => tax.type?.trim().toLowerCase() === normalizedFilter,
    );
  }

  async getSupportDocumentTypeId(companyId: string): Promise<number> {
    const cache = await this.ensureCompanyCache(companyId);

    if (!isValidSiigoConfigurationId(cache.supportDocumentId)) {
      throw new Error(
        `No se pudo resolver el id de Documento Soporte para la empresa ${companyId}.`,
      );
    }

    this.logger.log(
      `[companyId=${companyId}] Tipo de documento DS servido desde caché en memoria (id=${cache.supportDocumentId})`,
    );

    return cache.supportDocumentId;
  }

  async getPurchaseDocumentTypeId(companyId: string): Promise<number> {
    const cache = await this.ensureCompanyCache(companyId);

    if (!isValidSiigoConfigurationId(cache.purchaseDocumentId)) {
      throw new Error(
        `No se pudo resolver el id de factura de compra para la empresa ${companyId}.`,
      );
    }

    this.logger.log(
      `[companyId=${companyId}] Tipo de documento FC servido desde caché en memoria (id=${cache.purchaseDocumentId})`,
    );

    return cache.purchaseDocumentId;
  }

  async getSupportDocumentConfig(
    companyId: string,
  ): Promise<SiigoSupportDocumentConfig> {
    const cache = await this.ensureCompanyCache(companyId);

    return buildSiigoSupportDocumentConfig(
      cache.catalog,
      cache.supportDocumentId,
      companyId,
    );
  }

  async getPurchaseConfig(companyId: string): Promise<SiigoPurchaseConfig> {
    const cache = await this.ensureCompanyCache(companyId);

    return buildSiigoPurchaseConfig(
      cache.catalog,
      cache.purchaseDocumentId,
      companyId,
    );
  }

  invalidateCompanyCache(companyId: string): void {
    this.memoryCacheByCompany.delete(companyId);
  }

  private async ensureCompanyCache(companyId: string): Promise<SiigoCompanyMemoryCache> {
    const cached = this.memoryCacheByCompany.get(companyId);

    if (
      cached &&
      isSiigoMemoryCacheFresh(cached.fetchedAt) &&
      hasUsableSiigoCatalogCache(cached.catalog) &&
      isValidSiigoConfigurationId(cached.supportDocumentId) &&
      isValidSiigoConfigurationId(cached.purchaseDocumentId)
    ) {
      this.logger.log(
        `[companyId=${companyId}] Catálogo SIIGO servido desde caché en memoria (lastSync=${cached.catalog.lastSync})`,
      );

      return cached;
    }

    return this.syncCompanyCache(companyId);
  }

  private async syncCompanyCache(companyId: string): Promise<SiigoCompanyMemoryCache> {
    const existingSync = this.syncInProgressByCompany.get(companyId);

    if (existingSync) {
      return existingSync;
    }

    const syncPromise = this.performCompanyCacheSync(companyId).finally(() => {
      this.syncInProgressByCompany.delete(companyId);
    });

    this.syncInProgressByCompany.set(companyId, syncPromise);
    return syncPromise;
  }

  private async performCompanyCacheSync(
    companyId: string,
  ): Promise<SiigoCompanyMemoryCache> {
    this.logger.log(
      `[companyId=${companyId}] Caché SIIGO expirada o inexistente. Consultando SIIGO...`,
    );

    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const company = await resolveSiigoCompany(
      this.companiesRepository,
      companyId,
    );

    const [
      ,
      paymentTypes,
      taxes,
      supportDocumentId,
      purchaseDocumentId,
    ] = await Promise.all([
      this.syncRecentAccountsFromBalanceTrial(company.id),
      this.syncPaymentTypesCatalog(companyId),
      this.syncTaxesCatalog(companyId),
      this.syncSupportDocumentTypeId(companyId),
      this.syncPurchaseDocumentTypeId(companyId),
    ]);

    const accounts = await this.syncAccountsCatalog(company.id, integration.id);

    const catalog: SiigoCatalogCache = {
      lastSync: buildSiigoCatalogCacheTimestamp(),
      accounts,
      paymentTypes,
      taxes,
    };

    const memoryCache: SiigoCompanyMemoryCache = {
      fetchedAt: Date.now(),
      catalog,
      supportDocumentId,
      purchaseDocumentId,
    };

    this.memoryCacheByCompany.set(companyId, memoryCache);

    this.logger.log(
      `[companyId=${companyId}] Caché SIIGO actualizada en memoria (accounts=${accounts.length}, taxes=${taxes.length}, paymentTypes=${Object.keys(paymentTypes).join(', ')}, supportDocumentId=${supportDocumentId}, purchaseDocumentId=${purchaseDocumentId})`,
    );

    return memoryCache;
  }

  private async syncRecentAccountsFromBalanceTrial(
    companyId: string,
  ): Promise<void> {
    try {
      const summary =
        await this.siigoAccountsBalanceSyncService.syncAccountsFromRecentMonths(
          companyId,
        );

      this.logger.log(
        `[companyId=${companyId}] Cuentas actualizadas desde balance de prueba (created=${summary.accountsCreated}, processedRows=${summary.processedRows})`,
      );
    } catch (error) {
      this.logger.warn(
        `[companyId=${companyId}] No se pudo sincronizar cuentas desde balance de prueba. Se usará el catálogo local.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  private async syncSupportDocumentTypeId(companyId: string): Promise<number> {
    const persistedId = await this.readPersistedDocumentTypeId(
      companyId,
      'support_document_id',
    );

    if (persistedId != null) {
      this.logger.log(
        `[companyId=${companyId}] Usando comprobante DS configurado (id=${persistedId})`,
      );
      return persistedId;
    }

    const documentTypes = await executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'consultar tipos de documento soporte',
      (accessToken, partnerId) =>
        this.siigoHttpClient.listDocumentTypes(
          accessToken,
          SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
          partnerId,
        ),
    );

    return pickSiigoDocumentTypeId(
      documentTypes,
      SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
      'Documento Soporte',
    );
  }

  private async syncPurchaseDocumentTypeId(companyId: string): Promise<number> {
    const persistedId = await this.readPersistedDocumentTypeId(
      companyId,
      'purchase_invoice_id',
    );

    if (persistedId != null) {
      this.logger.log(
        `[companyId=${companyId}] Usando comprobante FC configurado (id=${persistedId})`,
      );
      return persistedId;
    }

    const documentTypes = await executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'consultar tipos de factura de compra',
      (accessToken, partnerId) =>
        this.siigoHttpClient.listDocumentTypes(
          accessToken,
          SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
          partnerId,
        ),
    );

    return pickSiigoDocumentTypeId(
      documentTypes,
      SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
      'factura de compra',
    );
  }

  private async readPersistedDocumentTypeId(
    companyId: string,
    key: 'support_document_id' | 'purchase_invoice_id',
  ): Promise<number | null> {
    try {
      const integration = await getSiigoIntegration(
        this.integrationsRepository,
        companyId,
      );
      const credentials = normalizeSiigoCredentials(integration.credentials);
      const value = credentials.document_types?.[key];

      return isValidSiigoConfigurationId(value) ? value : null;
    } catch {
      return null;
    }
  }

  private async syncAccountsCatalog(
    companyId: string,
    integrationId: string,
  ): Promise<SiigoCachedAccountCatalogItem[]> {
    return this.loadAccountsFromDatabase(companyId, integrationId);
  }

  private async loadAccountsFromDatabase(
    companyId: string,
    integrationId?: string,
  ): Promise<SiigoCachedAccountCatalogItem[]> {
    const resolvedIntegrationId =
      integrationId ??
      (await getSiigoIntegration(this.integrationsRepository, companyId)).id;

    const accounts =
      await this.siigoAccountsRepository.findByCompanyAndIntegration(
        companyId,
        resolvedIntegrationId,
      );

    return collectUniqueAccountsCatalog(accounts);
  }

  private async syncPaymentTypesCatalog(
    companyId: string,
  ): Promise<Record<string, SiigoCachedPaymentTypeCatalogItem[]>> {
    const entries = await Promise.all(
      PAYMENT_DOCUMENT_TYPES_TO_SYNC.map(async (documentType) => {
        const paymentTypes = await executeSiigoRequestWithRetries(
          this.siigoAuthService,
          companyId,
          this.logger,
          `consultar medios de pago (${documentType})`,
          (accessToken, partnerId) =>
            this.siigoHttpClient.listPaymentTypes(
              accessToken,
              documentType,
              partnerId,
            ),
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
    companyId: string,
  ): Promise<SiigoCachedTaxCatalogItem[]> {
    const taxes = await executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'consultar impuestos',
      (accessToken, partnerId) =>
        this.siigoHttpClient.listTaxes(accessToken, partnerId),
    );

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
