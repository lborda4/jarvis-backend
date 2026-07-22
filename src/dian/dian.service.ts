import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AppConfiguration } from '../config/configuration';
import { CompaniesRepository } from '../company/repositories/companies.repository';
import { DianParserService } from './dian-parser.service';
import { extractInvoiceXmlFromZip } from './helpers/dian-xml.helper';
import {
  DIAN_DEFAULT_HEADERS,
  DIAN_DOWNLOAD_URL,
} from './constants/dian.constants';
import { SearchDianRequestDto } from './dto/search-dian-request.dto';
import { SearchDianResponseDto } from './dto/search-dian-response.dto';
import { DianInvoiceResult } from './interfaces/dian-invoice-result.interface';

@Injectable()
export class DianService {
  constructor(
    private readonly httpService: HttpService,
    private readonly dianParserService: DianParserService,
    private readonly companiesRepository: CompaniesRepository,
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  async searchInvoices(
    request: SearchDianRequestDto,
    companyId: string,
  ): Promise<SearchDianResponseDto> {
    const cufes = this.validateCufes(request.cufes);
    await this.resolveCompany(companyId);
    const dianCookie = this.getDianCookie();

    const resultados: DianInvoiceResult[] = [];
    const errores: SearchDianResponseDto['errores'] = [];

    for (const cufe of cufes) {
      try {
        const resultado = await this.processCufe(cufe, dianCookie);
        resultados.push(resultado);
      } catch (error) {
        errores.push({
          cufe,
          mensaje: this.getErrorMessage(error),
        });
      }
    }

    return {
      totalProcesados: cufes.length,
      totalExitosos: resultados.length,
      totalFallidos: errores.length,
      resultados,
      errores,
    };
  }

  private async processCufe(
    cufe: string,
    dianCookie: string,
  ): Promise<DianInvoiceResult> {
    const zipBuffer = await this.downloadZip(cufe, dianCookie);
    const xmlContent = this.extractXmlFromZip(zipBuffer);
    return this.dianParserService.parseInvoiceXml(xmlContent, cufe);
  }

  private async downloadZip(cufe: string, cookie: string): Promise<Buffer> {
    const response = await firstValueFrom(
      this.httpService.get(`${DIAN_DOWNLOAD_URL}?trackId=${cufe}`, {
        responseType: 'arraybuffer',
        maxRedirects: 0,
        validateStatus: () => true,
        headers: {
          ...DIAN_DEFAULT_HEADERS,
          Cookie: cookie,
        },
      }),
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `La DIAN respondió con estado ${response.status} para el CUFE ${cufe}`,
      );
    }

    const contentType = String(response.headers['content-type'] ?? '');

    if (
      !contentType.includes('zip') &&
      !contentType.includes('octet-stream')
    ) {
      throw new Error(
        `La respuesta de la DIAN no es un archivo ZIP para el CUFE ${cufe}`,
      );
    }

    return Buffer.from(response.data);
  }

  private async resolveCompany(companyId: string): Promise<void> {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    const company = await this.companiesRepository.findById(trimmedCompanyId);

    if (!company) {
      throw new BadRequestException(
        `No se encontró la empresa con id ${trimmedCompanyId}.`,
      );
    }
  }

  private getDianCookie(): string {
    const cookie = this.configService.get('dian.cookie', { infer: true })?.trim();

    if (!cookie) {
      throw new BadRequestException(
        'No está configurada la cookie DIAN (DIAN_COOKIE).',
      );
    }

    return cookie;
  }

  private extractXmlFromZip(zipBuffer: Buffer): string {
    return extractInvoiceXmlFromZip(zipBuffer);
  }

  private validateCufes(cufes?: string[]): string[] {
    if (!cufes || !Array.isArray(cufes) || cufes.length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un CUFE en el arreglo "cufes".',
      );
    }

    const normalized = cufes
      .map((cufe) => cufe?.trim())
      .filter((cufe): cufe is string => Boolean(cufe));

    if (normalized.length === 0) {
      throw new BadRequestException(
        'El arreglo "cufes" no contiene valores válidos.',
      );
    }

    return normalized;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Error desconocido al procesar el CUFE';
  }
}
