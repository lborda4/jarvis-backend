import { BadRequestException, Injectable } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import { JarvisResolutionDto } from './dto/jarvis-resolution.dto';

const MAX_RESOLUTION_PDF_SIZE = 10 * 1024 * 1024;

const RANGE_PATTERN =
  /(DOCUMENTO\s+SOPORTE|FACTURA\s+ELECTR[OÓ]NICA\s+DE\s+VENTA)\s+(\d+)\s+([A-Z0-9]+)\s+([\d.,]+)\s+([\d.,]+)\s+(AUTORIZACI[OÓ]N|HABILITACI[OÓ]N|INHABILITACI[OÓ]N)(?:\s+(\d+))?/i;

const FORM_NUMBER_PATTERN = /\b(1\d{13})\b/;
const RESOLUTION_NUMBER_PATTERN =
  /\b(?:resoluci[oó]n(?:\s+n[uú]mero)?|n[uú]mero\s+de\s+resoluci[oó]n)[:\s]+(\d{7,15})\b/i;
const TECHNICAL_KEY_PATTERN =
  /\b(?:clave\s+t[eé]cnica|technical\s*key)[:\s]*([a-fA-F0-9]{20,})\b/i;
const DATE_PATTERN = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
const YEAR_SPACED_PATTERN = /\b2\s*0\s*2\s*[0-9]\b/;

@Injectable()
export class JarvisResolutionParserService {
  async parse(file?: Express.Multer.File): Promise<{
    resolution: JarvisResolutionDto;
    warnings: string[];
  }> {
    this.validateFile(file);

    const parser = new PDFParse({ data: new Uint8Array(file!.buffer) });

    try {
      const result = await parser.getText();
      return this.parseText(result.text);
    } catch (error) {
      throw new BadRequestException(
        error instanceof BadRequestException
          ? error.message
          : 'No se pudo leer la resolución. Verifique que sea un PDF válido y no esté protegido.',
      );
    } finally {
      await parser.destroy();
    }
  }

  parseText(text: string): {
    resolution: JarvisResolutionDto;
    warnings: string[];
  } {
    const normalized = text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
    const rangeMatch = normalized.match(RANGE_PATTERN);

    if (!rangeMatch) {
      throw new BadRequestException(
        'No se encontró el rango de numeración en el PDF. Verifique que sea una autorización DIAN de factura electrónica o documento soporte.',
      );
    }

    const documentTypeLabel = this.cleanDocumentType(rangeMatch[1]);
    const kind = this.resolveKind(documentTypeLabel);
    const modalityCode = rangeMatch[2];
    const prefix = rangeMatch[3].toUpperCase();
    const fromNumber = this.parseNumeric(rangeMatch[4]);
    const toNumber = this.parseNumeric(rangeMatch[5]);
    const requestType = this.normalizeAccent(rangeMatch[6]).toUpperCase();

    if (!Number.isFinite(fromNumber) || !Number.isFinite(toNumber)) {
      throw new BadRequestException(
        'No se pudieron leer los números Desde/Hasta de la resolución.',
      );
    }

    if (toNumber < fromNumber) {
      throw new BadRequestException(
        'El rango de la resolución es inválido: Hasta es menor que Desde.',
      );
    }

    const warnings: string[] = [];
    const formNumberFromLabel =
      normalized.match(RESOLUTION_NUMBER_PATTERN)?.[1] ?? null;
    const formNumber =
      formNumberFromLabel ??
      normalized.match(FORM_NUMBER_PATTERN)?.[1] ??
      null;
    const nitInfo = this.extractNit(normalized);
    const businessName = this.extractBusinessName(normalized);
    const authorizedAt = this.extractAuthorizedAt(normalized);
    const technicalKey = this.extractTechnicalKey(normalized);
    const dates = this.extractDates(normalized);
    const dateFrom = dates[0] ?? authorizedAt;
    const dateTo = dates[1] ?? this.addOneYear(dateFrom);
    const year =
      authorizedAt?.slice(0, 4) ??
      this.extractYear(normalized) ??
      null;

    if (!formNumber) {
      warnings.push('No se pudo identificar el número de resolución.');
    }
    if (!nitInfo.nit) {
      warnings.push('No se pudo identificar el NIT.');
    }
    if (!businessName) {
      warnings.push('No se pudo identificar la razón social.');
    }
    if (!authorizedAt) {
      warnings.push('No se pudo identificar la fecha de autorización.');
    }
    if (!technicalKey) {
      warnings.push(
        'No se pudo identificar la clave técnica. Complétela manualmente.',
      );
    }
    if (!dateFrom || !dateTo) {
      warnings.push(
        'No se pudo identificar la vigencia completa. Revise Desde/Hasta.',
      );
    }

    return {
      resolution: {
        kind,
        formNumber,
        nit: nitInfo.nit,
        checkDigit: nitInfo.checkDigit,
        businessName,
        documentTypeLabel,
        modalityCode,
        prefix,
        fromNumber,
        toNumber,
        requestType,
        year,
        authorizedAt,
        technicalKey,
        dateFrom,
        dateTo,
      },
      warnings,
    };
  }

  private validateFile(file?: Express.Multer.File): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'Debe adjuntar el archivo PDF de la resolución DIAN.',
      );
    }

    if (file.size > MAX_RESOLUTION_PDF_SIZE) {
      throw new BadRequestException(
        'La resolución no puede pesar más de 10 MB.',
      );
    }

    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.originalname?.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      throw new BadRequestException(
        'El archivo de la resolución debe ser un PDF válido.',
      );
    }
  }

  private resolveKind(documentTypeLabel: string): JarvisResolutionKind {
    const normalized = this.normalizeAccent(documentTypeLabel).toUpperCase();

    if (normalized.includes('DOCUMENTO SOPORTE')) {
      return JarvisResolutionKind.SUPPORT_DOCUMENT;
    }

    if (normalized.includes('FACTURA')) {
      return JarvisResolutionKind.ELECTRONIC_INVOICE;
    }

    throw new BadRequestException(
      `Tipo de resolución no soportado: ${documentTypeLabel}`,
    );
  }

  private cleanDocumentType(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toUpperCase();
  }

  private parseNumeric(value: string): number {
    return Number(String(value).replace(/[^\d]/g, ''));
  }

  private extractNit(text: string): {
    nit: string | null;
    checkDigit: string | null;
  } {
    const candidates = [...text.matchAll(/\b((?:\d\s*){9,10})\b/g)]
      .map((match) => match[1].replace(/\s+/g, ''))
      .filter((value) => value.length >= 9 && value.length <= 10);

    // Prefer the company NIT near the form number / business name section.
    const preferred =
      candidates.find((value) => value.startsWith('9')) ?? candidates[0];

    if (!preferred) {
      return { nit: null, checkDigit: null };
    }

    if (preferred.length === 10) {
      return {
        nit: preferred.slice(0, 9),
        checkDigit: preferred.slice(9),
      };
    }

    return { nit: preferred, checkDigit: null };
  }

  private extractBusinessName(text: string): string | null {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const rangeIndex = lines.findIndex((line) => RANGE_PATTERN.test(line));
    if (rangeIndex > 0) {
      const previous = lines[rangeIndex - 1];
      if (
        previous &&
        !/CALLE|CARRERA|AVENIDA|CRA|CL\b|\d{5,}/i.test(previous) &&
        /[A-ZÁÉÍÓÚÑ]/.test(previous)
      ) {
        // Prefer the plain company name line over "NAME ADDRESS".
        const plainName = lines
          .slice(Math.max(0, rangeIndex - 3), rangeIndex)
          .find(
            (line) =>
              /S\.?\s*A\.?\s*S\.?|S\.?\s*A\.?|LTDA|SAS/i.test(line) &&
              !/CALLE|CARRERA|AVENIDA|CRA|CL\b/i.test(line),
          );

        return plainName ?? previous.split(/\s+CALLE|\s+CARRERA|\s+CRA/i)[0];
      }
    }

    const companyLine = lines.find((line) =>
      /S\.?\s*A\.?\s*S\.?|LTDA|S\.?\s*A\.?/i.test(line),
    );

    return companyLine?.split(/\s+CALLE|\s+CARRERA|\s+CRA/i)[0]?.trim() ?? null;
  }

  private extractAuthorizedAt(text: string): string | null {
    const match = text.match(DATE_PATTERN);
    if (!match) {
      return null;
    }

    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  private extractTechnicalKey(text: string): string | null {
    return text.match(TECHNICAL_KEY_PATTERN)?.[1] ?? null;
  }

  private extractDates(text: string): string[] {
    const matches = [...text.matchAll(new RegExp(DATE_PATTERN, 'g'))];
    const unique = [
      ...new Set(
        matches.map((match) => `${match[1]}-${match[2]}-${match[3]}`),
      ),
    ];
    return unique;
  }

  private addOneYear(value?: string | null): string | null {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }

    const [year, month, day] = value.split('-').map(Number);
    return `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private extractYear(text: string): string | null {
    const spaced = text.match(YEAR_SPACED_PATTERN)?.[0];
    if (spaced) {
      return spaced.replace(/\s+/g, '');
    }

    return text.match(/\b(20\d{2})\b/)?.[1] ?? null;
  }

  private normalizeAccent(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
}
