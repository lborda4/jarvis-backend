import { CompaniesRepository } from '../../../company/repositories/companies.repository';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IntegrationProvider } from '../../enums/integration-provider.enum';
import { normalizeJarvisCredentials } from '../helpers/jarvis-credentials.helper';
import { IntegrationsRepository } from '../../repositories/integrations.repository';
import {
  NextPymeApiClient,
  NextPymeMasterRow,
  NextPymeResolution,
} from './nextpyme-api.client';

const CACHE_TTL_MS = 60 * 60 * 1000;
const SUPPORT_DOCUMENT_TYPE_ID = 11;
const ELECTRONIC_INVOICE_TYPE_ID = 1;
const DEFAULT_MUNICIPALITY_ID = 149; // Bogotá, D.C.
const DEFAULT_UNIT_MEASURE_ID = 70; // Unidad
const DEFAULT_ITEM_IDENTIFICATION_ID = 4;
const DEFAULT_GENERATION_TRANSMISSION_ID = 1;
const IVA_TAX_ID = 1;

interface CacheEntry<T> {
  loadedAt: number;
  value: T;
}

@Injectable()
export class NextPymeMasterCatalogService {
  private readonly cache = new Map<string, CacheEntry<NextPymeMasterRow[]>>();
  private readonly tableInFlight = new Map<
    string,
    Promise<NextPymeMasterRow[]>
  >();

  constructor(
    private readonly nextPymeApiClient: NextPymeApiClient,
    private readonly companies: CompaniesRepository,
    private readonly integrations: IntegrationsRepository,
  ) {}

  async requireCompanyToken(companyId?: string): Promise<string> {
    const company = companyId?.trim()
      ? await this.companies.findById(companyId.trim())
      : null;
    const token = company?.nextPymeToken?.trim();
    if (!token)
      throw new ServiceUnavailableException(
        'La empresa no tiene un token de NextPyme configurado.',
      );
    return token;
  }

  getSupportDocumentTypeId(): number {
    return SUPPORT_DOCUMENT_TYPE_ID;
  }

  getElectronicInvoiceTypeId(): number {
    return ELECTRONIC_INVOICE_TYPE_ID;
  }

  async listResolutions(companyId?: string): Promise<NextPymeResolution[]> {
    const [token, idSoftware] = await Promise.all([
      this.requireCompanyToken(companyId),
      this.requireIdSoftware(companyId),
    ]);
    return this.nextPymeApiClient.listResolutions(idSoftware, token);
  }

  private async requireIdSoftware(companyId?: string): Promise<string> {
    const integration = companyId?.trim()
      ? await this.integrations.findByCompanyAndProvider(
          companyId.trim(),
          IntegrationProvider.JARVIS,
        )
      : null;
    const idSoftware = normalizeJarvisCredentials(
      integration?.credentials ?? {},
    ).id_software?.trim();
    if (!idSoftware) {
      throw new ServiceUnavailableException(
        'La empresa no tiene un ID de software DIAN configurado.',
      );
    }
    return idSoftware;
  }

  getDefaultUnitMeasureId(): number {
    return DEFAULT_UNIT_MEASURE_ID;
  }

  getDefaultItemIdentificationId(): number {
    return DEFAULT_ITEM_IDENTIFICATION_ID;
  }

  getDefaultGenerationTransmissionId(): number {
    return DEFAULT_GENERATION_TRANSMISSION_ID;
  }

  getIvaTaxId(): number {
    return IVA_TAX_ID;
  }

  async getTypeRejections(companyId?: string): Promise<NextPymeMasterRow[]> {
    return this.getTable(
      'type_rejections',
      await this.requireCompanyToken(companyId),
    );
  }

  async getTaxes(companyId?: string): Promise<NextPymeMasterRow[]> {
    return this.getTable('taxes', await this.requireCompanyToken(companyId));
  }

  async getPaymentMethods(companyId?: string): Promise<NextPymeMasterRow[]> {
    return this.getTable(
      'payment_methods',
      await this.requireCompanyToken(companyId),
    );
  }

  async getPaymentForms(companyId?: string): Promise<NextPymeMasterRow[]> {
    return this.getTable(
      'payment_forms',
      await this.requireCompanyToken(companyId),
    );
  }

  async getTypeCurrencies(companyId?: string): Promise<NextPymeMasterRow[]> {
    return this.getTable(
      'type_currencies',
      await this.requireCompanyToken(companyId),
    );
  }

  async resolveCurrencyId(
    codeOrName?: string | null,
    companyId?: string,
  ): Promise<number | null> {
    const currencies = await this.getTypeCurrencies(companyId);
    const needle = this.normalizeText(codeOrName);

    if (!needle) {
      return null;
    }

    const byCode = currencies.find(
      (item) => this.normalizeText(item.code) === needle,
    );
    if (byCode) {
      return byCode.id;
    }

    const byName = currencies.find((item) =>
      this.normalizeText(item.name).includes(needle),
    );
    return byName?.id ?? null;
  }

  async getMunicipalities(companyId?: string): Promise<NextPymeMasterRow[]> {
    return this.getTable(
      'municipalities',
      await this.requireCompanyToken(companyId),
    );
  }

  /** Unidades de medida DIAN (tabla maestra `unit_measures`). El catálogo es
   * se consulta y cachea con el token propio de cada empresa. */
  async getUnitMeasures(tokenOverride?: string): Promise<NextPymeMasterRow[]> {
    return this.getTable('unit_measures', tokenOverride);
  }

  async getTypeLiabilities(companyId?: string): Promise<NextPymeMasterRow[]> {
    return this.getTable(
      'type_liabilities',
      await this.requireCompanyToken(companyId),
    );
  }

  async getTypeRegimes(companyId?: string): Promise<NextPymeMasterRow[]> {
    const rows = await this.getTable(
      'type_regime',
      await this.requireCompanyToken(companyId),
    );
    if (rows.length > 0) {
      return rows;
    }

    return this.getTable(
      'type_regimes',
      await this.requireCompanyToken(companyId),
    );
  }

  async resolveMunicipalityId(
    municipalityName?: string | null,
    cityName?: string | null,
    cityCode?: string | null,
    companyId?: string,
  ): Promise<number> {
    const municipalities = await this.getMunicipalities(companyId);
    const code = cityCode?.replace(/\D/g, '');

    if (code) {
      const byCode = municipalities.find(
        (item) => String(item.code ?? '').replace(/\D/g, '') === code,
      );
      if (byCode) {
        return byCode.id;
      }
    }

    const candidates = [municipalityName, cityName]
      .map((value) => this.normalizeText(value))
      .filter(Boolean);

    for (const candidate of candidates) {
      const exact = municipalities.find(
        (item) => this.normalizeText(item.name) === candidate,
      );
      if (exact) {
        return exact.id;
      }
    }

    for (const candidate of candidates) {
      const partial = municipalities.find((item) =>
        this.normalizeText(item.name).includes(candidate),
      );
      if (partial) {
        return partial.id;
      }
    }

    return DEFAULT_MUNICIPALITY_ID;
  }

  async resolveLiabilityId(
    codeOrName?: string | null,
    companyId?: string,
  ): Promise<number> {
    const liabilities = await this.getTypeLiabilities(companyId);
    const needle = this.normalizeText(codeOrName);

    if (needle) {
      const byCode = liabilities.find(
        (item) => this.normalizeText(item.code) === needle,
      );
      if (byCode) {
        return byCode.id;
      }

      const byName = liabilities.find((item) =>
        this.normalizeText(item.name).includes(needle),
      );
      if (byName) {
        return byName.id;
      }
    }

    const fallback = liabilities.find(
      (item) => this.normalizeText(item.code) === 'r99pn',
    );
    return fallback?.id ?? 117;
  }

  async resolveRegimeId(
    vatRegime?: string | null,
    companyId?: string,
  ): Promise<number> {
    const regimes = await this.getTypeRegimes(companyId);
    const needle = this.normalizeText(vatRegime);

    if (
      needle.includes('non_vat') ||
      needle.includes('noresponsable') ||
      needle.includes('49')
    ) {
      const nonResponsible = regimes.find(
        (item) =>
          this.normalizeText(item.code) === '49' ||
          this.normalizeText(item.name).includes('no responsable'),
      );
      if (nonResponsible) {
        return nonResponsible.id;
      }
    }

    const responsible = regimes.find(
      (item) =>
        this.normalizeText(item.code) === '48' ||
        this.normalizeText(item.name).includes('responsable de iva'),
    );

    return responsible?.id ?? 1;
  }

  private async getTable(
    table: string,
    tokenOverride?: string,
  ): Promise<NextPymeMasterRow[]> {
    if (!tokenOverride?.trim())
      throw new ServiceUnavailableException(
        'La empresa no tiene un token de NextPyme configurado.',
      );
    const cacheKey = tokenOverride.trim() + ':' + table;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
      return cached.value;
    }

    const inFlight = this.tableInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = this.nextPymeApiClient
      .fetchMasterTable(table, tokenOverride)
      .then((value) => {
        this.cache.set(cacheKey, { loadedAt: now, value });
        return value;
      })
      .finally(() => {
        this.tableInFlight.delete(cacheKey);
      });

    this.tableInFlight.set(cacheKey, request);
    return request;
  }

  private normalizeText(value?: string | null): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase()
      .trim();
  }
}
