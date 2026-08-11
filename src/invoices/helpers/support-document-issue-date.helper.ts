import { BadRequestException } from '@nestjs/common';
import { GroupedSupportDocument } from '../../electronic-document/interfaces/support-document-import.interface';

/**
 * Normaliza fechas de Documento soporte a YYYY-MM-DD (interno).
 * Acepta en Excel: dd/mm/aaaa, dd-mm-aaaa y también aaaa-mm-dd.
 */
export function normalizeSupportDocumentIssueDate(value?: string): string {
  const trimmed = value?.trim() ?? '';

  if (!trimmed) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);

  if (isoMatch) {
    return isoMatch[1];
  }

  const dayMonthYearMatch = trimmed.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/,
  );

  if (dayMonthYearMatch) {
    const day = dayMonthYearMatch[1].padStart(2, '0');
    const month = dayMonthYearMatch[2].padStart(2, '0');
    const year = dayMonthYearMatch[3];
    return `${year}-${month}-${day}`;
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
