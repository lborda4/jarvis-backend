import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppConfiguration } from '../../../config/configuration';

type UnknownRecord = Record<string, unknown>;

export interface NextPymeMasterRow {
  id: number;
  name: string;
  code?: string | null;
  description?: string | null;
  [key: string]: unknown;
}

export interface NextPymeResolution {
  id: number;
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
  technical_key: string;
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

const LOG_PREVIEW_LIMIT = 4000;

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
          `NextPyme respondió con estado ${response.status} al consultar ${table}.`,
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
        `No fue posible consultar la tabla maestra ${table} en NextPyme.`,
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
          `NextPyme respondió con estado ${response.status} al consultar resoluciones.`,
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
        'No fue posible consultar las resoluciones de NextPyme.',
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
        this.httpService.put<unknown>(
          `${baseUrl}/config/resolution`,
          payload,
          {
            headers: this.buildAuthHeaders(token),
            timeout: 30000,
            validateStatus: () => true,
          },
        ),
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
            `NextPyme respondió con estado ${response.status} al configurar la resolución.`,
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
        'No fue posible configurar la resolución en NextPyme.',
      );
    }
  }

  async createSupportDocument(
    payload: NextPymeSupportDocumentCreatePayload,
  ): Promise<UnknownRecord> {
    const token = this.requireToken();
    const baseUrl = this.getBaseUrl();

    this.logger.log(
      `[support-document] POST ${baseUrl}/support-document body=${JSON.stringify(
        payload,
        null,
        2,
      )}`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(
          `${baseUrl}/support-document`,
          payload,
          {
            headers: this.buildAuthHeaders(token),
            timeout: 60000,
            validateStatus: () => true,
          },
        ),
      );

      this.logger.log(
        `[support-document] status=${response.status} respuesta=${this.preview(
          response.data,
        )}`,
      );

      if (response.status < 200 || response.status >= 300) {
        const detail = this.extractErrorMessage(response.data);
        throw new BadGatewayException(
          detail ||
            `NextPyme respondió con estado ${response.status} al crear el documento soporte.`,
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
        'No fue posible crear el documento soporte en NextPyme.',
      );
    }
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
    const records = this.collectRecords(payload);
    const results: NextPymeMasterRow[] = [];

    for (const record of records) {
      const idValue = this.readValue(record, ['id']);
      const name = this.readValue(record, ['name', 'nombre', 'description']);

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
        code: this.readValue(record, ['code', 'codigo']) ?? null,
        description:
          this.readValue(record, ['description', 'descripcion']) ?? null,
      });
    }

    return results;
  }

  private parseResolutions(payload: unknown): NextPymeResolution[] {
    const root = (payload ?? {}) as UnknownRecord;
    const data = Array.isArray(root.data)
      ? root.data
      : Array.isArray(payload)
        ? payload
        : [];

    return data
      .filter((item): item is UnknownRecord => Boolean(item) && typeof item === 'object')
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
            item.technical_key != null
              ? String(item.technical_key)
              : undefined,
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

  private collectRecords(value: unknown): UnknownRecord[] {
    const records: UnknownRecord[] = [];
    const pending: unknown[] = [value];
    const visited = new Set<object>();

    while (pending.length > 0) {
      const current = pending.shift();

      if (!current || typeof current !== 'object' || visited.has(current)) {
        continue;
      }

      visited.add(current);

      if (Array.isArray(current)) {
        pending.push(...current);
        continue;
      }

      const record = current as UnknownRecord;
      records.push(record);
      pending.push(...Object.values(record));
    }

    return records;
  }

  private readValue(
    record: UnknownRecord,
    keys: string[],
  ): string | null {
    const normalizedKeys = new Set(
      keys.map((key) =>
        key
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9]/g, '')
          .toLowerCase(),
      ),
    );

    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = key
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();

      if (!normalizedKeys.has(normalizedKey)) {
        continue;
      }

      if (typeof value === 'string' || typeof value === 'number') {
        const normalized = String(value).trim();
        if (normalized && normalized.toLowerCase() !== 'null') {
          return normalized;
        }
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
        'NextPyme no está configurado. Falta NEXTPYME_API_TOKEN.',
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
