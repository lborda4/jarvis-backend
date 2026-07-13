import { BadRequestException } from '@nestjs/common';
import { GroupedSupportDocument } from '../../electronic-document/interfaces/support-document-import.interface';

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

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    return `${slashMatch[3]}-${month}-${day}`;
  }

  throw new BadRequestException(
    'La fecha de emisión debe tener formato YYYY-MM-DD.',
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
