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
import {
  collectRecords,
  findInRecord,
  UnknownRecord,
} from './nextpyme/nextpyme-record-scan.helper';

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
  private documentTypesCacheInFlight: Promise<NextPymeDocumentType[]> | null =
    null;

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

    // Si ya hay una carga en curso, todas las llamadas concurrentes esperan
    // esa misma promesa en vez de disparar una request por cada una
    // ("thundering herd" cuando el caché está frío/vencido).
    if (this.documentTypesCacheInFlight) {
      return this.documentTypesCacheInFlight;
    }

    this.documentTypesCacheInFlight = this.fetchDocumentTypes(
      token,
      baseUrl,
      now,
    ).finally(() => {
      this.documentTypesCacheInFlight = null;
    });

    return this.documentTypesCacheInFlight;
  }

  private async fetchDocumentTypes(
    token: string,
    baseUrl: string,
    now: number,
  ): Promise<NextPymeDocumentType[]> {
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
    const records = collectRecords(payload, { parseJsonStrings: true });
    const results: NextPymeDocumentType[] = [];

    for (const record of records) {
      const idValue = findInRecord(record, [
        'id',
        'typeid',
        'typedocumentidentificationid',
      ]);
      const name =
        findInRecord(record, [
          'name',
          'nombre',
          'description',
          'descripcion',
        ]) ?? null;
      const code = findInRecord(record, ['code', 'codigo', 'abbreviation']);

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
    const records = collectRecords(payload, { parseJsonStrings: true });
    const matchingRecords = records.filter((record) => {
      const identification = findInRecord(record, [
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
    // Código DANE (DIVIPOLA) de ciudad/departamento — no siempre viene en la
    // respuesta de RUT/RUES (depende de qué tan completo esté el registro),
    // por eso se busca con varias llaves posibles igual que los demás
    // campos, y se deja en null si no aparece (el llamador cae a su propio
    // default). OJO: NO incluir 'municipalityid'/'idmunicipality'/
    // 'departmentid' acá — esas son el ID interno de NextPyme en SU PROPIA
    // tabla de municipios/departamentos (el mismo que usa
    // NextPymeMasterCatalogService.resolveMunicipalityId para crear
    // documentos), no el código DIVIPOLA. Bug real reportado: una respuesta
    // de RUT/RUES sin ningún campo DIVIPOLA nombrado (citycode/
    // municipalitycode/codigomunicipio) caía a `municipality_id`/
    // `department_id` (ids internos pequeños tipo "1"/"2") y esos se
    // mandaban tal cual a SIIGO como si fueran DIVIPOLA, que los rechazaba
    // con invalid_reference ("Co|2|1" no existe como ciudad).
    const cityCode = this.findValue(orderedRecords, [
      'citycode',
      'municipalitycode',
      'codemunicipality',
      'codigomunicipio',
    ]);
    const cityName = this.findValue(orderedRecords, [
      'city',
      'municipality',
      'municipio',
      'ciudad',
    ]);
    const stateCode = this.findValue(orderedRecords, [
      'statecode',
      'departmentcode',
      'codigodepartamento',
    ]);

    return {
      found: Boolean(checkDigit || name || email || phone || address),
      document_number: documentNumber,
      check_digit: checkDigit,
      name,
      email,
      phone,
      address,
      cityCode,
      cityName,
      stateCode,
    };
  }

  private findValue(
    records: UnknownRecord[],
    candidateKeys: string[],
  ): string | null {
    for (const candidate of candidateKeys) {
      for (const record of records) {
        const value = findInRecord(record, [candidate]);
        if (value) {
          return value;
        }
      }
    }

    return null;
  }
}
