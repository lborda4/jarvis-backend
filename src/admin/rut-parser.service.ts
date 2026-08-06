import { BadRequestException, Injectable } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { CompanyPersonType } from '../company/enums/company-person-type.enum';
import { JarvisTaxRegime } from '../integration/jarvis/enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from '../integration/jarvis/enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from '../integration/jarvis/enums/jarvis-vat-regime.enum';
import {
  ParsedRutDataDto,
  ParsedRutJarvisCredentialsDto,
} from './dto/parse-rut.dto';

const MAX_RUT_PDF_SIZE = 10 * 1024 * 1024;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

@Injectable()
export class RutParserService {
  async parse(file?: Express.Multer.File): Promise<ParsedRutDataDto> {
    this.validateFile(file);

    const parser = new PDFParse({ data: new Uint8Array(file!.buffer) });

    try {
      const result = await parser.getText();
      return this.parseText(result.text);
    } catch (error) {
      throw new BadRequestException(
        error instanceof BadRequestException
          ? error.message
          : 'No se pudo leer el RUT. Verifique que sea un PDF válido y no esté protegido.',
      );
    } finally {
      await parser.destroy();
    }
  }

  parseText(text: string): ParsedRutDataDto {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    if (
      lines.length === 0 ||
      !lines.some((line) => /Registro Único Tributario|RUT|DIAN/i.test(line))
    ) {
      throw new BadRequestException(
        'El archivo no parece ser un RUT de la DIAN o no contiene texto legible.',
      );
    }

    const firstPageEnd = lines.findIndex((line) => /^-- 1 of \d+ --$/i.test(line));
    const firstPage = firstPageEnd >= 0 ? lines.slice(0, firstPageEnd) : lines;
    const identity = this.extractNit(firstPage);
    const personType = this.extractPersonType(firstPage);
    const name = this.extractCompanyName(firstPage, personType);
    const emailIndex = firstPage.findIndex((line) => EMAIL_PATTERN.test(line));
    const email =
      emailIndex >= 0 ? firstPage[emailIndex].match(EMAIL_PATTERN)?.[0] ?? null : null;
    const address = this.extractAddress(firstPage, emailIndex);
    const phone = this.extractPhone(firstPage, emailIndex);
    const responsibleName = this.extractResponsibleName(lines);
    const location = this.extractLocation(firstPage);
    const taxRegime = this.extractTaxRegime(lines);
    const vatRegime = this.extractVatRegime(lines);
    const taxResponsibility = this.extractTaxResponsibility(lines);
    const economicActivity = this.extractEconomicActivity(lines);
    const warnings: string[] = [];

    if (!address) warnings.push('No se pudo identificar la dirección.');
    if (!email) warnings.push('No se pudo identificar el correo electrónico.');
    if (!phone) warnings.push('No se pudo identificar el teléfono.');
    if (!responsibleName) {
      warnings.push('No se pudo identificar el representante o persona a cargo.');
    }
    if (!location.department || !location.municipality) {
      warnings.push('No se pudo identificar departamento/municipio con seguridad.');
    }
    if (!taxRegime) {
      warnings.push('No se pudo identificar el régimen tributario. Revíselo manualmente.');
    }
    if (!vatRegime) {
      warnings.push('No se pudo identificar el régimen de IVA. Revíselo manualmente.');
    }
    if (!economicActivity) {
      warnings.push(
        'No se pudo identificar la actividad económica (CIIU). Complétela manualmente.',
      );
    }

    const jarvisCredentials: ParsedRutJarvisCredentialsDto = {
      business_name: name,
      trade_name: null,
      tax_regime: taxRegime,
      vat_regime: vatRegime,
      tax_responsibility: taxResponsibility,
      economic_activity: economicActivity,
      country: location.country,
      department: location.department,
      municipality: location.municipality,
      city: location.city,
      email: email?.toLowerCase() ?? null,
      address,
      phone,
    };

    return {
      nit: identity.nit,
      verificationDigit: identity.verificationDigit,
      name,
      personType,
      address,
      email: email?.toLowerCase() ?? null,
      phone,
      responsibleName,
      jarvisCredentials,
      warnings,
    };
  }

  private validateFile(
    file?: Express.Multer.File,
  ): asserts file is Express.Multer.File {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Debe adjuntar el archivo PDF del RUT.');
    }

    if (file.size > MAX_RUT_PDF_SIZE) {
      throw new BadRequestException('El RUT no puede pesar más de 10 MB.');
    }

    const hasPdfSignature = file.buffer.subarray(0, 5).toString() === '%PDF-';
    const hasPdfMimeType =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');

    if (!hasPdfSignature || !hasPdfMimeType) {
      throw new BadRequestException('El archivo del RUT debe ser un PDF válido.');
    }
  }

  private extractNit(lines: string[]): {
    nit: string;
    verificationDigit: string | null;
  } {
    const inscriptionIndex = lines.findIndex((line) =>
      /^Inscripci[oó]n\b/i.test(line),
    );
    const searchFrom = inscriptionIndex >= 0 ? inscriptionIndex + 1 : 0;

    for (let index = searchFrom; index < lines.length; index += 1) {
      const line = lines[index];

      if (!/Impuestos de/i.test(line)) continue;

      const digitsBeforeSection = line.split(/Impuestos de/i)[0].replace(/\D/g, '');

      if (digitsBeforeSection.length >= 9) {
        return {
          nit: digitsBeforeSection.slice(0, -1),
          verificationDigit: digitsBeforeSection.slice(-1),
        };
      }
    }

    throw new BadRequestException(
      'No se pudo identificar el NIT en el RUT. Revise el PDF cargado.',
    );
  }

  private extractPersonType(lines: string[]): CompanyPersonType {
    if (lines.some((line) => /Persona jur[ií]dica/i.test(line))) {
      return CompanyPersonType.LEGAL_ENTITY;
    }

    if (lines.some((line) => /Persona natural/i.test(line))) {
      return CompanyPersonType.NATURAL_PERSON;
    }

    throw new BadRequestException(
      'No se pudo identificar si el contribuyente es persona natural o jurídica.',
    );
  }

  private extractCompanyName(
    lines: string[],
    personType: CompanyPersonType,
  ): string {
    const personTypeIndex = lines.findIndex((line) =>
      personType === CompanyPersonType.LEGAL_ENTITY
        ? /Persona jur[ií]dica/i.test(line)
        : /Persona natural/i.test(line),
    );

    if (personTypeIndex >= 0) {
      const candidate = lines[personTypeIndex + 1];

      if (
        candidate &&
        !/^(COLOMBIA|Fecha|Impuestos|--)/i.test(candidate) &&
        candidate.length >= 3
      ) {
        return candidate;
      }
    }

    throw new BadRequestException(
      'No se pudo identificar el nombre o razón social en el RUT.',
    );
  }

  private extractLocation(lines: string[]): {
    country: string | null;
    department: string | null;
    municipality: string | null;
    city: string | null;
  } {
    const locationLine = lines.find((line) => /^COLOMBIA\b/i.test(line));

    if (!locationLine) {
      return {
        country: 'Colombia',
        department: null,
        municipality: null,
        city: null,
      };
    }

    const withoutCountryAndDigits = locationLine
      .replace(/^COLOMBIA\s+/i, '')
      .replace(/(?:^|\s)\d(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!withoutCountryAndDigits) {
      return {
        country: 'Colombia',
        department: null,
        municipality: null,
        city: null,
      };
    }

    const dcSplit = withoutCountryAndDigits.match(/^(.+?\bD\.C\.)\s+(.+)$/i);
    let department: string;
    let municipality: string;

    if (dcSplit) {
      department = dcSplit[1].trim();
      municipality = dcSplit[2].trim();
    } else {
      const words = withoutCountryAndDigits.split(/\s+/);
      const mid = Math.max(1, Math.ceil(words.length / 2));
      department = words.slice(0, mid).join(' ');
      municipality = words.slice(mid).join(' ') || department;
    }

    const city =
      municipality
        .replace(/,/g, '')
        .replace(/\s*D\.?\s*C\.?/gi, '')
        .replace(/\s+/g, ' ')
        .trim() || municipality;

    return {
      country: 'Colombia',
      department,
      municipality,
      city,
    };
  }

  private extractTaxRegime(lines: string[]): JarvisTaxRegime | null {
    const text = lines.join(' ');

    if (/O-47|R[eé]gimen Simple|Simple de Tributaci[oó]n/i.test(text)) {
      return JarvisTaxRegime.SIMPLIFIED;
    }

    if (/r[eé]gimen especial/i.test(text)) {
      return JarvisTaxRegime.SPECIAL;
    }

    if (
      /r[eé]gimen ordinario|Impuesto de renta.*ordinario|complementario r[eé]gimen ordinario/i.test(
        text,
      )
    ) {
      return JarvisTaxRegime.COMMON;
    }

    return null;
  }

  private extractVatRegime(lines: string[]): JarvisVatRegime | null {
    const text = lines.join(' ');

    if (/No responsable.*IVA|no responsable del impuesto sobre las ventas/i.test(text)) {
      return JarvisVatRegime.NON_RESPONSIBLE;
    }

    if (
      /\b48\s*[-–].*IVA|Impuesto sobre las ventas\s*-\s*IVA|Responsable de IVA/i.test(
        text,
      )
    ) {
      return JarvisVatRegime.RESPONSIBLE;
    }

    return null;
  }

  private extractTaxResponsibility(
    lines: string[],
  ): JarvisTaxResponsibility {
    const text = lines.join(' ');

    if (/\bO-13\b|Gran contribuyente/i.test(text)) {
      return JarvisTaxResponsibility.LARGE_TAXPAYER;
    }

    if (/\bO-15\b|Autorretenedor/i.test(text)) {
      return JarvisTaxResponsibility.SELF_WITHHOLDER;
    }

    if (/\bO-23\b|Agente de retenci[oó]n.*ventas/i.test(text)) {
      return JarvisTaxResponsibility.VAT_WITHHOLDING_AGENT;
    }

    if (/\bO-47\b|R[eé]gimen Simple de Tributaci[oó]n/i.test(text)) {
      return JarvisTaxResponsibility.SIMPLE_REGIME;
    }

    return JarvisTaxResponsibility.NOT_APPLICABLE;
  }

  private extractEconomicActivity(lines: string[]): string | null {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const inlineMatch = line.match(
        /CIIU\s*[:#]?\s*(\d{4})\b(?:\s*[-–:]?\s*(.+))?/i,
      );

      if (inlineMatch) {
        const code = inlineMatch[1];
        const description =
          inlineMatch[2]?.trim() ||
          this.findNearbyActivityDescription(lines, index);
        return description ? `${code} - ${description}` : code;
      }

      if (/Actividad econ[oó]mica/i.test(line)) {
        const next = lines[index + 1];
        const codeMatch = next?.match(/^(\d{4})\b(?:\s*[-–:]?\s*(.+))?/);
        if (codeMatch) {
          const description =
            codeMatch[2]?.trim() ||
            this.findNearbyActivityDescription(lines, index + 1);
          return description ? `${codeMatch[1]} - ${description}` : codeMatch[1];
        }

        if (next && !/^\d+$/.test(next) && next.length > 8) {
          return next;
        }
      }
    }

    return null;
  }

  private findNearbyActivityDescription(
    lines: string[],
    fromIndex: number,
  ): string | null {
    for (
      let index = fromIndex + 1;
      index <= Math.min(lines.length - 1, fromIndex + 2);
      index += 1
    ) {
      const candidate = lines[index];
      if (
        candidate &&
        candidate.length > 8 &&
        !/^(CIIU|Fecha|Impuestos|--|\d{4}$)/i.test(candidate)
      ) {
        return candidate;
      }
    }

    return null;
  }

  private extractAddress(lines: string[], emailIndex: number): string | null {
    if (emailIndex <= 0) return null;

    for (let index = emailIndex - 1; index >= Math.max(0, emailIndex - 3); index -= 1) {
      const candidate = lines[index];

      if (
        candidate &&
        !/COLOMBIA.*\d/i.test(candidate) &&
        !/Correo electr[oó]nico/i.test(candidate)
      ) {
        return candidate;
      }
    }

    return null;
  }

  private extractPhone(lines: string[], emailIndex: number): string | null {
    if (emailIndex < 0) return null;

    for (
      let index = emailIndex + 1;
      index <= Math.min(lines.length - 1, emailIndex + 3);
      index += 1
    ) {
      const digits = lines[index].replace(/\D/g, '');

      if (digits.length >= 10) {
        return digits.slice(-10);
      }
    }

    return null;
  }

  private extractResponsibleName(lines: string[]): string | null {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (!/C[eé]dula de Ciudadan/i.test(lines[index])) continue;

      const candidate = lines[index + 1];
      if (candidate && /^[A-ZÁÉÍÓÚÑ.\s]{5,}$/i.test(candidate)) {
        return candidate;
      }
    }

    const representativeIndex = lines.findIndex((line) =>
      /^REPRESENTANTE$/i.test(line),
    );

    return representativeIndex > 0 ? lines[representativeIndex - 1] : null;
  }
}
