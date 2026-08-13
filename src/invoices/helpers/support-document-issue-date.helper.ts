import { BadRequestException } from '@nestjs/common';
import { GroupedSupportDocument } from '../../electronic-document/interfaces/support-document-import.interface';
import {
  convertDayMonthYearToIso,
  matchIsoDate,
} from '../../common/helpers/date-normalization.helper';

/**
 * Normaliza fechas de Documento soporte a YYYY-MM-DD (interno).
 * Acepta en Excel: dd/mm/aaaa, dd-mm-aaaa y también aaaa-mm-dd.
 */
export function normalizeSupportDocumentIssueDate(value?: string): string {
  const trimmed = value?.trim() ?? '';

  if (!trimmed) {
    return '';
  }

  const isoDate = matchIsoDate(trimmed);

  if (isoDate) {
    return isoDate;
  }

  const converted = convertDayMonthYearToIso(trimmed, {
    allowDotSeparator: true,
  });

  if (converted) {
    return converted;
  }

  throw new BadRequestException(
    'La fecha de emisión debe tener formato día/mes/año (ej. 10/06/2026).',
  );
}

export function applySupportDocumentIssueDate(
  groups: GroupedSupportDocument[],
  issueDate?: string,
): void {
  const normalizedRequestDate = issueDate
    ? normalizeSupportDocumentIssueDate(issueDate)
    : '';

  for (const group of groups) {
    const excelIssueDate = group.issueDate?.trim()
      ? normalizeSupportDocumentIssueDate(group.issueDate)
      : '';

    group.issueDate = excelIssueDate || normalizedRequestDate || '';
  }
}
