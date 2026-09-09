import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';
import { AppConfiguration } from '../../../config/configuration';
import {
  collectRecords,
  findInRecord,
  normalizeRecordKey,
  normalizeRecordValue,
  UnknownRecord,
} from './nextpyme-record-scan.helper';
import { parseDianValidationResult } from './nextpyme-dian-validation.helper';

export interface NextPymeMasterRow {
  id: number;
  name: string;
  code?: string | null;
  description?: string | null;
  [key: string]: unknown;
}

/** type_document_id de una resolución que vino en el sobre DIAN
 * (GetNumberingRangeResponse), donde ese dato no existe: ahí la DIAN
 * identifica cada rango por prefijo, no por el tipo de documento de
 * NextPyme. Sirve para que `find(type_document_id === X)` no la confunda
 * nunca con una resolución de tipo conocido. */
export const NEXTPYME_UNKNOWN_TYPE_DOCUMENT_ID = 0;

export interface NextPymeResolution {
  id: number;
  /** NEXTPYME_UNKNOWN_TYPE_DOCUMENT_ID cuando la respuesta no lo trae. */
  type_document_id: number;
  prefix: string;
  number: number;
  next_consecutive?: string;
  from?: number;
  to?: number;
  resolution?: string;
  resolution_date?: string;
  technical_key?: string;
  date_from?: string;
  date_to?: string;
  type_document?: {
    id: number;
    name: string;
    code?: string;
    prefix?: string;
  };
}

export interface NextPymeConfigResolutionPayload {
  type_document_id: number;
  prefix: string;
  resolution: string;
  resolution_date: string;
  /** Documento soporte no lleva clave técnica (la DIAN no se la asigna). */
  technical_key?: string;
  from: number;
  to: number;
  generated_to_date?: number;
  date_from: string;
  date_to: string;
}

export interface NextPymeSupportDocumentCreatePayload {
  type_document_id: number;
  number: number;
  date?: string;
  time?: string;
  prefix?: string;
  notes?: string;
  type_currency_id?: number;
  seller: {
    identification_number: number | string;
    dv?: number | string;
    name: string;
    phone?: string;
    address?: string;
    email?: string;
    type_document_identification_id: number;
    type_organization_id: number;
    municipality_id: number;
    type_liability_id: number;
    type_regime_id: number;
  };
  payment_form?: {
    payment_form_id: number;
    payment_method_id: number;
    payment_due_date?: string;
    duration_measure?: string | number;
  };
  legal_monetary_totals: {
    line_extension_amount: string;
    tax_exclusive_amount: string;
    tax_inclusive_amount: string;
    payable_amount: string;
    allowance_total_amount?: string;
    charge_total_amount?: string;
    pre_paid_amount?: number | string;
  };
  tax_totals?: Array<{
    tax_id: number;
    tax_amount: string;
    taxable_amount: string;
    percent: string;
  }>;
  invoice_lines: Array<{
    unit_measure_id: number;
    invoiced_quantity: number | string;
    line_extension_amount: number | string;
    free_of_charge_indicator: boolean;
    description: string;
    code: string;
    type_item_identification_id: number;
    price_amount: number | string;
    base_quantity: number | string;
    type_generation_transmition_id?: number;
    start_date?: string;
    tax_totals?: Array<{
      tax_id: number;
      tax_amount: string;
      taxable_amount: string;
      percent: string;
    }>;
  }>;
}

export interface NextPymeInvoiceCreatePayload {
  type_document_id: number;
  number: number;
  date?: string;
  time?: string;
  prefix?: string;
  notes?: string;
  head_note?: string;
  foot_note?: string;
  type_currency_id?: number;
  customer: {
    identification_number: number | string;
    dv?: number | string;
    name: string;
    phone?: string;
    address?: string;
    email?: string;
    merchant_registration?: string;
    type_document_identification_id: number;
    type_organization_id: number;
    municipality_id: number;
    type_liability_id: number;
    type_regime_id: number;
  };
  payment_form?: {
    payment_form_id: number;
    payment_method_id: number;
    payment_due_date?: string;
    duration_measure?: string | number;
  };
  allowance_charges?: Array<{
    discount_id: number;
    charge_indicator: boolean;
    allowance_charge_reason: string;
    amount: string;
    base_amount: string;
  }>;
  legal_monetary_totals: {
    line_extension_amount: string;
    tax_exclusive_amount: string;
    tax_inclusive_amount: string;
    payable_amount: string;
    allowance_total_amount?: string;
    charge_total_amount?: string;
    pre_paid_amount?: number | string;
  };
  tax_totals?: Array<{
    tax_id: number;
    tax_amount: string;
    taxable_amount: string;
    percent: string;
  }>;
  invoice_lines: Array<{
    unit_measure_id: number;
    invoiced_quantity: number | string;
    line_extension_amount: number | string;
    free_of_charge_indicator: boolean;
    description: string;
    notes?: string;
    code: string;
    type_item_identification_id: number;
    price_amount: number | string;
    base_quantity: number | string;
    type_generation_transmition_id?: number;
    start_date?: string;
    tax_totals?: Array<{
      tax_id: number;
      tax_amount: string;
      taxable_amount: string;
      percent: string;
    }>;
  }>;
}

export interface NextPymeInvoiceQueryParty {
  identification_number?: string | number;
  name?: string;
  address?: string;
  department?: string;
  city?: string;
  phone?: string;
  email?: string;
  code?: string;
  type_identification?: string | number;
  municipality?: {
    name?: string;
    code?: string;
    department?: {
      name?: string;
      code?: string;
    };
  };
}

export interface NextPymeInvoiceQueryLineTax {
  tax_id?: number;
  tax_amount?: string | number;
  taxable_amount?: string | number;
  percent?: string | number;
}

export interface NextPymeInvoiceQueryLineAllowanceCharge {
  discount_id?: string;
  charge_indicator?: string | boolean;
  allowance_charge_reason?: string;
  amount?: string | number;
  base_amount?: string | number;
}

export interface NextPymeInvoiceQueryLine {
  invoiced_quantity?: string | number;
  line_extension_amount?: string | number;
  free_of_charge_indicator?: string | boolean;
  description?: string;
  code?: string;
  price_amount?: string | number;
  base_quantity?: string | number;
  tax_totals?: NextPymeInvoiceQueryLineTax[];
  allowance_charges?: NextPymeInvoiceQueryLineAllowanceCharge[];
}

export interface NextPymeInvoiceQueryResult {
  type_document_id?: number;
  prefix?: string;
  number?: string | number;
  date?: string;
  time?: string;
  resolution?: string;
  notes?: string;
  seller: NextPymeInvoiceQueryParty;
  customer?: NextPymeInvoiceQueryParty;
  payment_form?: {
    payment_form_id?: string | number;
    payment_method_id?: string | number;
    payment_due_date?: string;
    duration_measure?: string | number;
  };
  legal_monetary_totals: {
    line_extension_amount?: string | number;
    tax_exclusive_amount?: string | number;
    tax_inclusive_amount?: string | number;
    allowance_total_amount?: string | number;
    charge_total_amount?: string | number;
    payable_amount?: string | number;
  };
  /** Impuestos totales a nivel de factura (no por línea) — la fuente
   * correcta para el IVA del documento, evita duplicar cuando hay
   * varias líneas. */
  tax_totals?: NextPymeInvoiceQueryLineTax[];
  /** Retenciones SUGERIDAS por el vendedor a nivel de factura — mismo nivel
   * que tax_totals, un elemento por tipo de retención (ReteIVA/
   * ReteFuente-ReteRenta/ReteICA). `tax_code` es el código DIAN estable
   * (05=ReteIVA, 06=ReteFuente/ReteRenta, 07=ReteICA — confirmado contra
   * datos reales); `tax_name` es un texto libre que varía (ej. "ReteRenta"
   * vs "ReteFuente" para el mismo código 06), así que el mapeo a tipo debe
   * hacerse por `tax_code`, nunca por `tax_name`. */
  with_holding_tax_totals?: Array<{
    tax_code?: string;
    tax_name?: string;
    tax_amount?: string | number;
    percent?: string | number;
    amount?: string | number;
  }>;
  invoice_lines: NextPymeInvoiceQueryLine[];
}

type NextPymeAttemptOutcome =
  | { outcome: 'found'; data: NextPymeInvoiceQueryResult }
  | { outcome: 'not_found' }
  | { outcome: 'error'; message: string; status?: number; retryable: boolean };

/** `attempts`/`retryDelayMs` van en las tres variantes (no solo 'error')
 * porque una fila puede fallar en el intento 1 pero encontrarse recién en
 * el 3 — para medir cuánto del tiempo de la fase NextPyme de un lote es
 * trabajo real vs. espera de backoff, hace falta saberlo también cuando el
 * resultado final fue 'found'/'not_found'. */
interface NextPymeLookupMetrics {
  /** Intentos HTTP realizados (1 = sin reintentos). */
  attempts: number;
  /** Tiempo total dormido en backoff entre reintentos — no incluye el
   * tiempo de la llamada HTTP en sí. */
  retryDelayMs: number;
}

export type NextPymeInvoiceLookupResult = NextPymeLookupMetrics &
  NextPymeAttemptOutcome;

const LOG_PREVIEW_LIMIT = 4000;

/** Códigos que indican un problema con la solicitud misma (CUFE no
 * existente, request mal formado, token inválido) — reintentar no cambia
 * el resultado, así que se falla directo en vez de gastar tiempo en
 * reintentos que van a volver a fallar igual. */
const NON_RETRYABLE_HTTP_STATUS = new Set([400, 401, 404]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff exponencial para los reintentos de una consulta a NextPyme:
 * intento 1 → 1s, intento 2 → 3s, intento 3 → 9s, etc. */
function computeRetryDelayMs(attempt: number): number {
  return 1000 * 3 ** (attempt - 1);
}

@Injectable()
export class NextPymeApiClient {
  private readonly logger = new Logger(NextPymeApiClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  async fetchMasterTable(table: string): Promise<NextPymeMasterRow[]> {
    const token = this.requireToken();
    const baseUrl = this.getBaseUrl();

    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(
          `${baseUrl}/reports/master/database`,
          { tables: [{ table }] },
          {
            headers: this.buildAuthHeaders(token),
            timeout: 20000,
            validateStatus: () => true,
          },
        ),
      );

      this.logger.log(
        `[master:${table}] status=${response.status} respuesta=${this.preview(
          response.data,
        )}`,
      );

      if (response.status < 200 || response.status >= 300) {
        throw new BadGatewayException(
          `No se pudieron cargar los catálogos (código ${response.status}).`,
        );
      }

      const rows = this.parseMasterRows(response.data);

      this.logger.log(
        `[master:${table}] filas=${rows.length} muestra=${this.preview(
          rows.slice(0, 5),
        )}`,
      );

      return rows;
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      throw new BadGatewayException(
        'No fue posible cargar el catálogo solicitado. Intenta nuevamente.',
      );
    }
  }

  async listResolutions(
    filters?: Partial<{ type_document_id: number; prefix: string }>,
  ): Promise<NextPymeResolution[]> {
    const token = this.requireToken();
    const baseUrl = this.getBaseUrl();
    const params: Record<string, string | number> = {};

    if (filters?.type_document_id != null) {
      params.type_document_id = filters.type_document_id;
    }

    if (filters?.prefix?.trim()) {
      params.prefix = filters.prefix.trim();
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<unknown>(`${baseUrl}/reports/resolutions`, {
          headers: this.buildAuthHeaders(token),
          params,
          timeout: 20000,
          validateStatus: () => true,
        }),
      );

      this.logger.log(
        `[resolutions] status=${response.status} params=${JSON.stringify(
          params,
        )} respuesta=${this.preview(response.data)}`,
      );

      if (response.status < 200 || response.status >= 300) {
        throw new BadGatewayException(
          `No se pudieron consultar las resoluciones (código ${response.status}).`,
        );
      }

      return this.parseResolutions(response.data);
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      throw new BadGatewayException(
        'No fue posible consultar las resoluciones. Intenta nuevamente.',
      );
    }
  }

  async putConfigResolution(
    payload: NextPymeConfigResolutionPayload,
  ): Promise<UnknownRecord> {
    const token = this.requireToken();
    const baseUrl = this.getBaseUrl();

    this.logger.log(
      `[config/resolution] PUT ${baseUrl}/config/resolution body=${JSON.stringify(
        payload,
        null,
        2,
      )}`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.put<unknown>(`${baseUrl}/config/resolution`, payload, {
          headers: this.buildAuthHeaders(token),
          timeout: 30000,
          validateStatus: () => true,
        }),
      );

      this.logger.log(
        `[config/resolution] status=${response.status} respuesta=${this.preview(
          response.data,
        )}`,
      );

      if (response.status < 200 || response.status >= 300) {
        const detail = this.extractErrorMessage(response.data);
        throw new BadGatewayException(
          detail ||
            `No se pudo configurar la resolución (código ${response.status}).`,
        );
      }

      return (response.data as UnknownRecord) ?? {};
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      throw new BadGatewayException(
        'No fue posible configurar la resolución. Intenta nuevamente.',
      );
    }
  }

  async createSupportDocument(
    payload: NextPymeSupportDocumentCreatePayload,
  ): Promise<UnknownRecord> {
    return this.postDianUblDocument(
      'support-document',
      payload,
      'el documento soporte',
    );
  }

  async createInvoice(
    payload: NextPymeInvoiceCreatePayload,
  ): Promise<UnknownRecord> {
    return this.postDianUblDocument('invoice', payload, 'la factura de venta');
  }

  /**
   * POST genérico a un endpoint ubl2.1 que emite un documento ante la DIAN
   * (support-document, invoice — misma forma de respuesta/validación en
   * ambos). Compartido para no duplicar el chequeo de `IsValid`: NextPyme
   * responde HTTP 200 con `success: true` incluso cuando la DIAN RECHAZÓ el
   * documento — el resultado real viaja anidado en `ResponseDian`. Sin este
   * chequeo, un documento rechazado se marcaba igual como enviado con
   * éxito. Ver parseDianValidationResult.
   */
  private async postDianUblDocument(
    endpointPath: string,
    payload: unknown,
    documentLabelForErrors: string,
  ): Promise<UnknownRecord> {
    const token = this.requireToken();
    const baseUrl = this.getBaseUrl();

    this.logger.log(
      `[${endpointPath}] POST ${baseUrl}/${endpointPath} body=${JSON.stringify(
        payload,
        null,
        2,
      )}`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(`${baseUrl}/${endpointPath}`, payload, {
          headers: this.buildAuthHeaders(token),
          timeout: 60000,
          validateStatus: () => true,
        }),
      );

      this.logger.log(
        `[${endpointPath}] status=${response.status} respuesta=${this.preview(
          response.data,
        )}`,
      );

      if (response.status < 200 || response.status >= 300) {
        const detail = this.extractErrorMessage(response.data);
        throw new BadGatewayException(
          detail ||
            `No se pudo crear ${documentLabelForErrors} (código ${response.status}).`,
        );
      }

      const data = (response.data as UnknownRecord) ?? {};
      const dianValidation = parseDianValidationResult(data);

      if (dianValidation?.isValid === false) {
        const reason =
          dianValidation.errorMessage ||
          dianValidation.statusDescription ||
          dianValidation.statusMessage ||
          'La DIAN rechazó el documento.';

        this.logger.error(
          `[${endpointPath}] DIAN rechazó el documento (statusCode=${
            dianValidation.statusCode ?? 'n/a'
          }): ${reason}`,
        );

        throw new BadGatewayException(
          `La DIAN rechazó ${documentLabelForErrors}: ${reason}`,
        );
      }

      return data;
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      throw new BadGatewayException(
        `No fue posible crear ${documentLabelForErrors}. Intenta nuevamente.`,
      );
    }
  }

  /**
   * Distingue "consultado con éxito pero la factura no existe" (`not_found`
   * — se omite la fila) de "no se pudo consultar" (`error`: timeout, rate
   * limit, 5xx, red). Ante `error`, solo reintenta si `retryable` es
   * `true` — un 400/401/404 significa que la solicitud misma está mal (CUFE
   * inexistente, token inválido), y reintentarla no cambia el resultado;
   * un 429/5xx/timeout sí puede resolverse solo. El resultado final sigue
   * siendo siempre la respuesta real de NextPyme, nunca un reemplazo del
   * Excel.
   */
  async getInvoiceByCufe(
    cufe: string,
    tokenOverride?: string,
  ): Promise<NextPymeInvoiceLookupResult> {
    const maxRetries = this.configService.get(
      'purchaseInvoiceImport.maxRetries',
      { infer: true },
    );
    let lastOutcome: NextPymeAttemptOutcome = {
      outcome: 'error',
      message: 'No se pudo consultar NextPyme.',
      retryable: true,
    };
    let totalRetryDelayMs = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        const delayMs = computeRetryDelayMs(attempt);
        totalRetryDelayMs += delayMs;
        this.logger.warn(
          `[cufe=${cufe}] Reintento ${attempt}/${maxRetries} en ${delayMs}ms tras: ${lastOutcome.message}`,
        );
        await delay(delayMs);
      }

      const outcome = await this.attemptGetInvoiceByCufe(cufe, tokenOverride);

      if (outcome.outcome !== 'error') {
        return {
          ...outcome,
          attempts: attempt + 1,
          retryDelayMs: totalRetryDelayMs,
        };
      }

      lastOutcome = outcome;

      if (!outcome.retryable) {
        return {
          ...outcome,
          attempts: attempt + 1,
          retryDelayMs: totalRetryDelayMs,
        };
      }
    }

    return {
      ...lastOutcome,
      attempts: maxRetries + 1,
      retryDelayMs: totalRetryDelayMs,
    };
  }

  private async attemptGetInvoiceByCufe(
    cufe: string,
    tokenOverride?: string,
  ): Promise<NextPymeAttemptOutcome> {
    // Prioriza el token propio de la empresa (companies.next_pyme_token); si
    // no tiene uno configurado, cae al NEXTPYME_API_TOKEN global.
    const token = tokenOverride?.trim() || this.requireToken();
    const url = this.getInvoiceQueryUrl();

    try {
      const response = await firstValueFrom(
        this.httpService.request<unknown>({
          method: 'GET',
          url,
          data: { qr_cufe: cufe },
          headers: this.buildAuthHeaders(token),
          timeout: 20000,
          validateStatus: () => true,
        }),
      );

      this.logger.log(
        `[return-invoice-data] cufe=${cufe} status=${response.status} respuesta=${this.preview(
          response.data,
        )}`,
      );

      if (response.status < 200 || response.status >= 300) {
        return {
          outcome: 'error',
          message: `NextPyme respondió con estado ${response.status}.`,
          status: response.status,
          retryable: !NON_RETRYABLE_HTTP_STATUS.has(response.status),
        };
      }

      const parsed = this.parseInvoiceQueryResponse(response.data);

      if (!parsed) {
        return { outcome: 'not_found' };
      }

      return { outcome: 'found', data: parsed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Un error de red/timeout de axios (sin response) es por definición
      // transitorio — nunca es un 400/401/404, esos SÍ llegan como response
      // arriba. isAxiosError(error) && !error.response cubre tanto timeout
      // (ECONNABORTED) como caídas de conexión.
      const retryable =
        !axios.isAxiosError(error) || !error.response
          ? true
          : !NON_RETRYABLE_HTTP_STATUS.has(error.response.status);

      this.logger.warn(
        `[return-invoice-data] Error al consultar CUFE ${cufe}: ${message}`,
      );

      return { outcome: 'error', message, retryable };
    }
  }

  private parseInvoiceQueryResponse(
    payload: unknown,
  ): NextPymeInvoiceQueryResult | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const root = payload as UnknownRecord;
    const data =
      root.data && typeof root.data === 'object'
        ? (root.data as UnknownRecord)
        : null;

    if (!data || !data.seller || !data.legal_monetary_totals) {
      return null;
    }

    return {
      ...data,
      invoice_lines: Array.isArray(data.invoice_lines)
        ? data.invoice_lines
        : [],
    } as unknown as NextPymeInvoiceQueryResult;
  }

  private getInvoiceQueryUrl(): string {
    return this.configService
      .get('nextPyme.invoiceQueryUrl', { infer: true })
      .trim();
  }

  private preview(value: unknown): string {
    let serialized: string;

    try {
      serialized = JSON.stringify(value) ?? String(value);
    } catch {
      return '[no serializable]';
    }

    return serialized.length > LOG_PREVIEW_LIMIT
      ? `${serialized.slice(0, LOG_PREVIEW_LIMIT)}... (${serialized.length} chars)`
      : serialized;
  }

  private parseMasterRows(payload: unknown): NextPymeMasterRow[] {
    const records = collectRecords(payload);
    const results: NextPymeMasterRow[] = [];

    for (const record of records) {
      const idValue = findInRecord(record, ['id']);
      const name = findInRecord(record, ['name', 'nombre', 'description']);

      if (!idValue || !name) {
        continue;
      }

      const id = Number(idValue);
      if (!Number.isFinite(id)) {
        continue;
      }

      results.push({
        ...record,
        id,
        name,
        code: findInRecord(record, ['code', 'codigo']) ?? null,
        description:
          findInRecord(record, ['description', 'descripcion']) ?? null,
      });
    }

    return results;
  }

  /** GET /reports/resolutions responde en DOS formatos según la cuenta: la
   * lista propia de NextPyme (`{ data: [...] }`) o el sobre crudo de la DIAN
   * (GetNumberingRangeResponse), que no trae id, type_document_id ni number y
   * por eso el parseo de lista lo descartaba entero, dejando la consulta en
   * cero resoluciones. Se intentan los dos. */
  private parseResolutions(payload: unknown): NextPymeResolution[] {
    const listResolutions = this.parseResolutionList(payload);

    return listResolutions.length > 0
      ? listResolutions
      : this.parseDianNumberingRanges(payload);
  }

  /** Rangos de numeración tal como los devuelve la DIAN, anidados en
   * ResponseDian.Envelope.Body...ResponseList.NumberRangeResponse. */
  private parseDianNumberingRanges(payload: unknown): NextPymeResolution[] {
    const ranges = this.readDianNumberRangeList(payload);

    return ranges
      .map((range, index) => {
        const fromNumber = Number(range.FromNumber);
        const toNumber = Number(range.ToNumber);
        const prefix = String(range.Prefix ?? '').trim();
        const technicalKey =
          range.TechnicalKey != null ? String(range.TechnicalKey) : undefined;

        return {
          // La DIAN no numera los rangos; el índice solo sirve como clave
          // estable dentro de esta misma respuesta.
          id: index + 1,
          type_document_id: NEXTPYME_UNKNOWN_TYPE_DOCUMENT_ID,
          prefix,
          number: fromNumber,
          from: Number.isFinite(fromNumber) ? fromNumber : undefined,
          to: Number.isFinite(toNumber) ? toNumber : undefined,
          resolution:
            range.ResolutionNumber != null
              ? String(range.ResolutionNumber)
              : undefined,
          resolution_date:
            range.ResolutionDate != null
              ? String(range.ResolutionDate)
              : undefined,
          // La resolución de documento soporte no lleva clave técnica: la
          // DIAN la devuelve en null y así se conserva.
          technical_key: technicalKey?.trim() ? technicalKey : undefined,
          date_from:
            range.ValidDateFrom != null
              ? String(range.ValidDateFrom)
              : undefined,
          date_to:
            range.ValidDateTo != null ? String(range.ValidDateTo) : undefined,
        } satisfies NextPymeResolution;
      })
      .filter((item) => item.prefix.length > 0 && Number.isFinite(item.number));
  }

  private readDianNumberRangeList(payload: unknown): UnknownRecord[] {
    const path = [
      'ResponseDian',
      'Envelope',
      'Body',
      'GetNumberingRangeResponse',
      'GetNumberingRangeResult',
      'ResponseList',
      'NumberRangeResponse',
    ];

    let node: unknown = payload;

    for (const key of path) {
      if (!node || typeof node !== 'object') {
        return [];
      }

      node = (node as UnknownRecord)[key];
    }

    // Con un solo rango, la conversión XML→JSON devuelve el objeto suelto en
    // vez de un arreglo de uno.
    const ranges = Array.isArray(node) ? node : node ? [node] : [];

    return ranges.filter(
      (item): item is UnknownRecord => Boolean(item) && typeof item === 'object',
    );
  }

  private parseResolutionList(payload: unknown): NextPymeResolution[] {
    const root = (payload ?? {}) as UnknownRecord;
    const data = Array.isArray(root.data)
      ? root.data
      : Array.isArray(payload)
        ? payload
        : [];

    return data
      .filter(
        (item): item is UnknownRecord =>
          Boolean(item) && typeof item === 'object',
      )
      .map((item) => {
        const typeDocument =
          item.type_document && typeof item.type_document === 'object'
            ? (item.type_document as UnknownRecord)
            : undefined;

        return {
          id: Number(item.id),
          type_document_id: Number(item.type_document_id),
          prefix: String(item.prefix ?? ''),
          number: Number(item.number),
          next_consecutive:
            item.next_consecutive != null
              ? String(item.next_consecutive)
              : undefined,
          from: item.from != null ? Number(item.from) : undefined,
          to: item.to != null ? Number(item.to) : undefined,
          resolution:
            item.resolution != null ? String(item.resolution) : undefined,
          resolution_date:
            item.resolution_date != null
              ? String(item.resolution_date)
              : undefined,
          technical_key:
            item.technical_key != null ? String(item.technical_key) : undefined,
          date_from:
            item.date_from != null ? String(item.date_from) : undefined,
          date_to: item.date_to != null ? String(item.date_to) : undefined,
          type_document: typeDocument
            ? {
                id: Number(typeDocument.id),
                name: String(typeDocument.name ?? ''),
                code:
                  typeDocument.code != null
                    ? String(typeDocument.code)
                    : undefined,
                prefix:
                  typeDocument.prefix != null
                    ? String(typeDocument.prefix)
                    : undefined,
              }
            : undefined,
        };
      })
      .filter(
        (item) =>
          Number.isFinite(item.id) &&
          Number.isFinite(item.type_document_id) &&
          Number.isFinite(item.number),
      );
  }

  private extractErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const record = payload as UnknownRecord;
    const candidates = [
      record.message,
      record.error,
      record.errors,
      (record.dian as UnknownRecord | undefined)?.errorMessage,
      (record.dian as UnknownRecord | undefined)?.statusMessage,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }

      if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate
          .map((item) => String(item))
          .filter(Boolean)
          .join(' | ');
      }
    }

    return null;
  }

  private requireToken(): string {
    const token = this.configService
      .get('nextPyme.apiToken', { infer: true })
      ?.trim();

    if (!token) {
      throw new ServiceUnavailableException(
        'La integración de facturación electrónica no está configurada. Contacta al administrador.',
      );
    }

    return token;
  }

  private getBaseUrl(): string {
    return this.configService
      .get('nextPyme.baseUrl', { infer: true })
      .replace(/\/+$/, '');
  }

  private buildAuthHeaders(token: string): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }
}
