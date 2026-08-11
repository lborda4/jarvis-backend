import { EXCEL_COLUMNS } from '../../common/constants/excel.constants';
import { ExcelRow } from '../../common/services/excel.service';
import { InvoicePreviewDto } from '../dto/invoice-preview.dto';

export function mapRowToInvoicePreview(row: ExcelRow): InvoicePreviewDto {
  return {
    cufe: getString(row, EXCEL_COLUMNS.CUFE),
    documentType: getString(row, EXCEL_COLUMNS.DOCUMENT_TYPE),
    issueDate: getString(row, EXCEL_COLUMNS.ISSUE_DATE),
    receptionDate: getString(row, EXCEL_COLUMNS.RECEPTION_DATE),
    issuerNit: getString(row, EXCEL_COLUMNS.ISSUER_NIT),
    issuerName: getString(row, EXCEL_COLUMNS.ISSUER_NAME),
    receiverNit: getString(row, EXCEL_COLUMNS.RECEIVER_NIT),
    receiverName: getString(row, EXCEL_COLUMNS.RECEIVER_NAME),
    currency: getString(row, EXCEL_COLUMNS.CURRENCY),
    paymentMethod:
      getString(row, EXCEL_COLUMNS.PAYMENT_FORM) ||
      getString(row, EXCEL_COLUMNS.PAYMENT_METHOD),
    total: getNumber(row, EXCEL_COLUMNS.TOTAL),
    status: getString(row, EXCEL_COLUMNS.STATUS),
    group: getString(row, EXCEL_COLUMNS.GROUP),
  };
}

function getString(row: ExcelRow, column: string): string {
  if (!(column in row)) {
    return '';
  }

  const value = row[column];

  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function getNumber(row: ExcelRow, column: string): number {
  if (!(column in row)) {
    return 0;
  }

  const value = row[column];

  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = Number(value);

  return Number.isNaN(parsed) ? 0 : parsed;
}

export function buildUniqueFilter(
  records: InvoicePreviewDto[],
  field: 'documentType' | 'status',
): string[] {
  return [...new Set(records.map((record) => record[field]).filter(Boolean))].sort();
}
