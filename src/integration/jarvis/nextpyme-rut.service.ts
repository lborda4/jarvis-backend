import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppConfiguration } from '../../config/configuration';
import { LookupJarvisTerceroNitResponseDto } from './dto/jarvis-tercero.dto';
import { JarvisDocumentType } from './enums/jarvis-document-type.enum';

type UnknownRecord = Record<string, unknown>;

interface NextPymeDocumentType {
  id: number;
  name: string;
  code?: string | null;
}

const FALLBACK_DOCUMENT_TYPE_IDS: Record<JarvisDocumentType, number> = {
  [JarvisDocumentType.NIT]: 6,
  [JarvisDocumentType.CC]: 3,
  [JarvisDocumentType.CE]: 5,
  [JarvisDocumentType.PA]: 7,
};

@Injectable()
export class NextPymeRutService {
  private documentTypesCache: NextPymeDocumentType[] | null = null;
  private documentTypesCacheLoadedAt = 0;
  private readonly documentTypesCacheTtlMs = 60 * 60 * 1000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  async lookupDocument(
    documentType: JarvisDocumentType,
    documentNumber: string,
    tokenOverride?: string,
  ): Promise<LookupJarvisTerceroNitResponseDto> {
    const token = tokenOverride?.trim() || this.requireToken();
    const baseUrl = this.getBaseUrl();
    const typeDocumentIdentificationId = await this.resolveDocumentTypeId(
      documentType,
      token,
      baseUrl,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(
          `${baseUrl}/rut-rues`,
          {
            identification_number: Number(documentNumber),
            rues: true,
            type_document_identification_id: typeDocumentIdentificationId,
          },
          {
            headers: this.buildAuthHeaders(token),
            timeout: 15000,
            validateStatus: () => true,
          },
        ),
      );

      if (response.status < 200 || response.status >= 300) {
        throw new BadGatewayException(
          `No se pudo consultar el documento (código ${response.status}). Intenta nuevamente.`,
        );
      }

      return this.normalizeResponse(response.data, documentNumber);
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      throw new BadGatewayException(
        'No fue posible consultar el documento. Intenta nuevamente.',
      );
    }
  }

  private async resolveDocumentTypeId(
    documentType: JarvisDocumentType,
    token: string,
    baseUrl: string,
  ): Promise<number> {
    const catalog = await this.getDocumentTypes(token, baseUrl);
    const matched = this.matchDocumentType(catalog, documentType);

    if (matched) {
      return matched.id;
    }

    return FALLBACK_DOCUMENT_TYPE_IDS[documentType];
  }

  private async getDocumentTypes(
    token: string,
    baseUrl: string,
  ): Promise<NextPymeDocumentType[]> {
    const now = Date.now();

    if (
      this.documentTypesCache &&
      now - this.documentTypesCacheLoadedAt < this.documentTypesCacheTtlMs
    ) {
      return this.documentTypesCache;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(
          `${baseUrl}/reports/master/database`,
          {
            tables: [
              { table: 'type_documents' },
              { table: 'type_document_identifications' },
            ],
          },
          {
            headers: this.buildAuthHeaders(token),
            timeout: 15000,
            validateStatus: () => true,
          },
        ),
      );

      if (response.status < 200 || response.status >= 300) {
        return this.documentTypesCache ?? [];
      }

      const parsed = this.parseDocumentTypes(response.data);
      this.documentTypesCache = parsed;
      this.documentTypesCacheLoadedAt = now;
      return parsed;
    } catch {
      return this.documentTypesCache ?? [];
    }
  }

  private parseDocumentTypes(payload: unknown): NextPymeDocumentType[] {
    const records = this.collectRecords(payload);
    const results: NextPymeDocumentType[] = [];

    for (const record of records) {
      const idValue = this.findInRecord(record, [
        'id',
        'typeid',
        'typedocumentidentificationid',
      ]);
      const name =
        this.findInRecord(record, ['name', 'nombre', 'description', 'descripcion']) ??
        null;
      const code = this.findInRecord(record, ['code', 'codigo', 'abbreviation']);

      if (!idValue || !name) {
        continue;
      }

      const id = Number(idValue);
      if (!Number.isFinite(id)) {
        continue;
      }

      results.push({ id, name, code });
    }

    return results;
  }

  private matchDocumentType(
    catalog: NextPymeDocumentType[],
    documentType: JarvisDocumentType,
  ): NextPymeDocumentType | null {
    const matchers: Record<JarvisDocumentType, RegExp[]> = {
      [JarvisDocumentType.NIT]: [/\bnit\b/i],
      [JarvisDocumentType.CC]: [
        /cedula\s*de\s*ciudadania/i,
        /\bcc\b/i,
        /ciudadania/i,
      ],
      [JarvisDocumentType.CE]: [
        /cedula\s*de\s*extranjer/i,
        /extranjer/i,
        /\bce\b/i,
      ],
      [JarvisDocumentType.PA]: [/pasaporte/i, /\bpa\b/i, /\bpp\b/i],
    };

    for (const item of catalog) {
      const haystack = `${item.name} ${item.code ?? ''}`;
      if (matchers[documentType].some((matcher) => matcher.test(haystack))) {
        return item;
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
        'La consulta de documentos no está configurada. Contacta al administrador.',
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

  private normalizeResponse(
    payload: unknown,
    documentNumber: string,
  ): LookupJarvisTerceroNitResponseDto {
    const records = this.collectRecords(payload);
    const matchingRecords = records.filter((record) => {
      const identification = this.findInRecord(record, [
        'identificationnumber',
        'numberidentification',
        'documentnumber',
        'nit',
      ]);

      return identification?.replace(/\D/g, '').startsWith(documentNumber);
    });
    const orderedRecords = [...matchingRecords, ...records];

    const checkDigit = this.findValue(orderedRecords, [
      'checkdigit',
      'verificationdigit',
      'digitverification',
      'digitoverificacion',
      'dv',
    ]);
    const name = this.findValue(orderedRecords, [
      'businessname',
      'razonsocial',
      'nombreorazonsocial',
      'companyname',
      'tradename',
      'nombre',
    ]);
    const email = this.findValue(orderedRecords, [
      'email',
      'correo',
      'correoelectronico',
      'electronicmail',
      'mail',
    ]);
    const phone = this.findValue(orderedRecords, [
      'phone',
      'telefono',
      'telephone',
      'mobile',
      'celular',
    ]);
    const address = this.findValue(orderedRecords, [
      'address',
      'direccion',
      'commercialaddress',
      'direccioncomercial',
      'addressline',
    ]);

    return {
      found: Boolean(checkDigit || name || email || phone || address),
      document_number: documentNumber,
      check_digit: checkDigit,
      name,
      email,
      phone,
      address,
    };
  }

  private collectRecords(value: unknown): UnknownRecord[] {
    const records: UnknownRecord[] = [];
    const pending: unknown[] = [value];
    const visited = new Set<object>();

    while (pending.length > 0) {
      const current = pending.shift();

      if (typeof current === 'string') {
        const trimmed = current.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            pending.push(JSON.parse(trimmed));
          } catch {
            // El valor es texto normal, no JSON anidado.
          }
        }
        continue;
      }

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

  private findValue(
    records: UnknownRecord[],
    candidateKeys: string[],
  ): string | null {
    for (const candidate of candidateKeys) {
      for (const record of records) {
        const value = this.findInRecord(record, [candidate]);
        if (value) {
          return value;
        }
      }
    }

    return null;
  }

  private findInRecord(
    record: UnknownRecord,
    candidateKeys: string[],
  ): string | null {
    const candidates = new Set(candidateKeys);

    for (const [key, value] of Object.entries(record)) {
      if (!candidates.has(this.normalizeKey(key))) {
        continue;
      }

      const normalizedValue = this.normalizeValue(value);
      if (normalizedValue) {
        return normalizedValue;
      }
    }

    return null;
  }

  private normalizeKey(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
  }

  private normalizeValue(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return null;
    }

    const normalized = String(value).trim();
    return normalized && normalized.toLowerCase() !== 'null'
      ? normalized
      : null;
  }
}
