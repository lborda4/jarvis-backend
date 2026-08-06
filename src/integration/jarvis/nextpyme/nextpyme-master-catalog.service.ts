import { BadRequestException, Injectable } from '@nestjs/common';
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
  private resolutionsCache: CacheEntry<NextPymeResolution[]> | null = null;

  constructor(private readonly nextPymeApiClient: NextPymeApiClient) {}

  getSupportDocumentTypeId(): number {
    return SUPPORT_DOCUMENT_TYPE_ID;
  }

  getElectronicInvoiceTypeId(): number {
    return ELECTRONIC_INVOICE_TYPE_ID;
  }

  getDefaultMunicipalityId(): number {
    return DEFAULT_MUNICIPALITY_ID;
  }

  invalidateResolutionsCache(): void {
    this.resolutionsCache = null;
  }

  async listResolutions(): Promise<NextPymeResolution[]> {
    return this.getResolutions();
  }

  async findResolutionByTypeDocumentId(
    typeDocumentId: number,
  ): Promise<NextPymeResolution | null> {
    const resolutions = await this.getResolutions();
    return (
      resolutions.find((item) => item.type_document_id === typeDocumentId) ??
      null
    );
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

  async getMunicipalities(): Promise<NextPymeMasterRow[]> {
    return this.getTable('municipalities');
  }

  async getTypeLiabilities(): Promise<NextPymeMasterRow[]> {
    return this.getTable('type_liabilities');
  }

  async getTypeRegimes(): Promise<NextPymeMasterRow[]> {
    return this.getTable('type_regimes');
  }

  async getTypeOrganizations(): Promise<NextPymeMasterRow[]> {
    return this.getTable('type_organizations');
  }

  async getTypeDocumentIdentifications(): Promise<NextPymeMasterRow[]> {
    return this.getTable('type_document_identifications');
  }

  async resolveSupportDocumentNumber(): Promise<{
    number: number;
    prefix: string;
    resolution: NextPymeResolution;
  }> {
    const resolutions = await this.getResolutions();
    const supportResolutions = resolutions.filter(
      (item) => item.type_document_id === SUPPORT_DOCUMENT_TYPE_ID,
    );

    const selected =
      supportResolutions.find((item) => Number.isFinite(item.number)) ??
      supportResolutions[0];

    if (!selected) {
      throw new BadRequestException(
        'No hay resolución de Documento Soporte (type_document_id=11) configurada en NextPyme. Configúrela antes de emitir.',
      );
    }

    return {
      number: selected.number,
      prefix: selected.prefix || 'DS',
      resolution: selected,
    };
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

    const value = await this.nextPymeApiClient.listResolutions();
    this.resolutionsCache = { loadedAt: now, value };
    return value;
  }

  private async getTable(table: string): Promise<NextPymeMasterRow[]> {
    const now = Date.now();
    const cached = this.cache.get(table);

    if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
      return cached.value;
    }

    const value = await this.nextPymeApiClient.fetchMasterTable(table);
    this.cache.set(table, { loadedAt: now, value });
    return value;
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
