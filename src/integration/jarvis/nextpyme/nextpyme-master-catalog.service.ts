import { Injectable } from '@nestjs/common';
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
  private resolutionsCache: CacheEntry<NextPymeResolution[]> | null = null;
  private resolutionsInFlight: Promise<NextPymeResolution[]> | null = null;

  constructor(private readonly nextPymeApiClient: NextPymeApiClient) {}

  getSupportDocumentTypeId(): number {
    return SUPPORT_DOCUMENT_TYPE_ID;
  }

  getElectronicInvoiceTypeId(): number {
    return ELECTRONIC_INVOICE_TYPE_ID;
  }

  invalidateResolutionsCache(): void {
    this.resolutionsCache = null;
  }

  async listResolutions(): Promise<NextPymeResolution[]> {
    return this.getResolutions();
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

  async getTaxes(): Promise<NextPymeMasterRow[]> {
    return this.getTable('taxes');
  }

  async getPaymentMethods(): Promise<NextPymeMasterRow[]> {
    return this.getTable('payment_methods');
  }

  async getPaymentForms(): Promise<NextPymeMasterRow[]> {
    return this.getTable('payment_forms');
  }

  async getTypeCurrencies(): Promise<NextPymeMasterRow[]> {
    return this.getTable('type_currencies');
  }

  async resolveCurrencyId(codeOrName?: string | null): Promise<number | null> {
    const currencies = await this.getTypeCurrencies();
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

  async getMunicipalities(tokenOverride?: string): Promise<NextPymeMasterRow[]> {
    return this.getTable('municipalities', tokenOverride);
  }

  /** Países (tabla maestra `countries`). Catálogo maestro común a todas las
   * empresas; el token solo se usa en la primera carga contra NextPyme. */
  async getCountries(tokenOverride?: string): Promise<NextPymeMasterRow[]> {
    return this.getTable('countries', tokenOverride);
  }

  /** Unidades de medida DIAN (tabla maestra `unit_measures`). El catálogo es
   * el mismo para todas las empresas (dato maestro DIAN), por eso se cachea
   * global; el token solo se usa en la primera carga contra NextPyme. */
  async getUnitMeasures(tokenOverride?: string): Promise<NextPymeMasterRow[]> {
    return this.getTable('unit_measures', tokenOverride);
  }

  async getTypeLiabilities(): Promise<NextPymeMasterRow[]> {
    return this.getTable('type_liabilities');
  }

  async getTypeRegimes(): Promise<NextPymeMasterRow[]> {
    return this.getTable('type_regimes');
  }

  async resolveMunicipalityId(
    municipalityName?: string | null,
    cityName?: string | null,
    cityCode?: string | null,
  ): Promise<number> {
    const municipalities = await this.getMunicipalities();
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

  async resolveLiabilityId(codeOrName?: string | null): Promise<number> {
    const liabilities = await this.getTypeLiabilities();
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

  async resolveRegimeId(vatRegime?: string | null): Promise<number> {
    const regimes = await this.getTypeRegimes();
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

  private async getResolutions(): Promise<NextPymeResolution[]> {
    const now = Date.now();

    if (
      this.resolutionsCache &&
      now - this.resolutionsCache.loadedAt < CACHE_TTL_MS
    ) {
      return this.resolutionsCache.value;
    }

    // Comparte la misma promesa entre llamadas concurrentes en vez de
    // disparar una request por cada una mientras el caché está frío.
    if (this.resolutionsInFlight) {
      return this.resolutionsInFlight;
    }

    this.resolutionsInFlight = this.nextPymeApiClient
      .listResolutions()
      .then((value) => {
        this.resolutionsCache = { loadedAt: now, value };
        return value;
      })
      .finally(() => {
        this.resolutionsInFlight = null;
      });

    return this.resolutionsInFlight;
  }

  private async getTable(
    table: string,
    tokenOverride?: string,
  ): Promise<NextPymeMasterRow[]> {
    const now = Date.now();
    const cached = this.cache.get(table);

    if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
      return cached.value;
    }

    const inFlight = this.tableInFlight.get(table);
    if (inFlight) {
      return inFlight;
    }

    const request = this.nextPymeApiClient
      .fetchMasterTable(table, tokenOverride)
      .then((value) => {
        this.cache.set(table, { loadedAt: now, value });
        return value;
      })
      .finally(() => {
        this.tableInFlight.delete(table);
      });

    this.tableInFlight.set(table, request);
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
