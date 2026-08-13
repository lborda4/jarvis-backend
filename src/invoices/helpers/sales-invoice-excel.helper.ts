import { BadRequestException } from '@nestjs/common';
import {
  DIAN_RECEIVED_GROUP,
  DIAN_SALES_INVOICE_DOCUMENT_TYPE,
  EXCEL_COLUMNS,
} from '../../common/constants/excel.constants';
import {
  convertDayMonthYearToIso,
  matchIsoDate,
} from '../../common/helpers/date-normalization.helper';
import type { ElectronicDocumentPayload } from '../../electronic-document/interfaces/electronic-document-payload.interface';
import * as XLSX from 'xlsx';

export interface DianSalesInvoiceRow {
  cufe: string;
  documentType: string;
  folio: string;
  prefix: string;
  currency: string;
  paymentForm: string;
  paymentMethod: string;
  issueDate: string;
  receptionDate: string;
  issuerNit: string;
  issuerName: string;
  receiverNit: string;
  receiverName: string;
  iva: number;
  total: number;
  status: string;
  group: string;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompare(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function cellString(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (value instanceof Date) {
    const day = String(value.getDate()).padStart(2, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const year = value.getFullYear();
    return `${day}-${month}-${year}`;
  }

  return String(value).trim();
}

function cellNumber(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = String(value).replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * DIAN exports dates as DD-MM-YYYY or DD-MM-YYYY HH:mm:ss.
 */
export function normalizeDianDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return (
    convertDayMonthYearToIso(trimmed) ?? matchIsoDate(trimmed) ?? trimmed
  );
}

function isSalesInvoiceReceived(row: DianSalesInvoiceRow): boolean {
  const documentType = normalizeCompare(row.documentType);
  const group = normalizeCompare(row.group);
  const expectedType = normalizeCompare(DIAN_SALES_INVOICE_DOCUMENT_TYPE);
  const expectedGroup = normalizeCompare(DIAN_RECEIVED_GROUP);

  return documentType === expectedType && group === expectedGroup;
}

function buildColumnIndex(headers: string[]): Map<string, number> {
  const index = new Map<string, number>();

  headers.forEach((header, i) => {
    const key = normalizeHeader(header);
    if (key) {
      index.set(key, i);
    }
  });

  return index;
}

function readByHeader(
  row: unknown[],
  columnIndex: Map<string, number>,
  column: string,
): unknown {
  const idx = columnIndex.get(column);
  if (idx === undefined) {
    return undefined;
  }

  return row[idx];
}

export function parseDianSalesInvoiceExcel(buffer: Buffer): {
  processedRows: number;
  rows: DianSalesInvoiceRow[];
} {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    raw: false,
  });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new BadRequestException('El archivo Excel no tiene hojas.');
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(
    sheet,
    {
      header: 1,
      defval: '',
      raw: false,
    },
  );

  if (!matrix.length) {
    throw new BadRequestException('El archivo Excel está vacío.');
  }

  const headers = (matrix[0] ?? []).map((cell) => normalizeHeader(cell));
  const columnIndex = buildColumnIndex(headers);

  const required = [
    EXCEL_COLUMNS.DOCUMENT_TYPE,
    EXCEL_COLUMNS.CUFE,
    EXCEL_COLUMNS.GROUP,
    EXCEL_COLUMNS.ISSUER_NIT,
    EXCEL_COLUMNS.TOTAL,
  ];

  const missing = required.filter((column) => !columnIndex.has(column));
  if (missing.length > 0) {
    throw new BadRequestException(
      `El Excel de DIAN no tiene las columnas requeridas: ${missing.join(', ')}.`,
    );
  }

  const parsed: DianSalesInvoiceRow[] = [];
  let processedRows = 0;

  for (let i = 1; i < matrix.length; i += 1) {
    const raw = matrix[i] ?? [];
    if (!raw.some((cell) => String(cell ?? '').trim())) {
      continue;
    }

    processedRows += 1;

    const row: DianSalesInvoiceRow = {
      cufe: cellString(readByHeader(raw, columnIndex, EXCEL_COLUMNS.CUFE)),
      documentType: cellString(
        readByHeader(raw, columnIndex, EXCEL_COLUMNS.DOCUMENT_TYPE),
      ),
      folio: cellString(readByHeader(raw, columnIndex, EXCEL_COLUMNS.FOLIO)),
      prefix: cellString(readByHeader(raw, columnIndex, EXCEL_COLUMNS.PREFIX)),
      currency:
        cellString(readByHeader(raw, columnIndex, EXCEL_COLUMNS.CURRENCY)) ||
        'COP',
      paymentForm: cellString(
        readByHeader(raw, columnIndex, EXCEL_COLUMNS.PAYMENT_FORM),
      ),
      paymentMethod: cellString(
        readByHeader(raw, columnIndex, EXCEL_COLUMNS.PAYMENT_METHOD),
      ),
      issueDate: cellString(
        readByHeader(raw, columnIndex, EXCEL_COLUMNS.ISSUE_DATE),
      ),
      receptionDate: cellString(
        readByHeader(raw, columnIndex, EXCEL_COLUMNS.RECEPTION_DATE),
      ),
      issuerNit: cellString(
        readByHeader(raw, columnIndex, EXCEL_COLUMNS.ISSUER_NIT),
      ).replace(/\D/g, ''),
      issuerName: cellString(
        readByHeader(raw, columnIndex, EXCEL_COLUMNS.ISSUER_NAME),
      ),
      receiverNit: cellString(
        readByHeader(raw, columnIndex, EXCEL_COLUMNS.RECEIVER_NIT),
      ).replace(/\D/g, ''),
      receiverName: cellString(
        readByHeader(raw, columnIndex, EXCEL_COLUMNS.RECEIVER_NAME),
      ),
      iva: cellNumber(readByHeader(raw, columnIndex, EXCEL_COLUMNS.IVA)),
      total: cellNumber(readByHeader(raw, columnIndex, EXCEL_COLUMNS.TOTAL)),
      status: cellString(readByHeader(raw, columnIndex, EXCEL_COLUMNS.STATUS)),
      group: cellString(readByHeader(raw, columnIndex, EXCEL_COLUMNS.GROUP)),
    };

    if (isSalesInvoiceReceived(row)) {
      parsed.push(row);
    }
  }

  return { processedRows, rows: parsed };
}

export function mapDianSalesInvoiceRowToPayload(
  row: DianSalesInvoiceRow,
): ElectronicDocumentPayload {
  const issueDate = normalizeDianDate(row.issueDate);
  const invoiceNumber = `${row.prefix}${row.folio}`.trim() || row.folio || row.cufe.slice(0, 12);
  const iva = row.iva > 0 ? row.iva : 0;
  const total = row.total;
  const subtotal = Math.max(total - iva, 0);

  return {
    supplier: {
      documentNumber: row.issuerNit,
      documentType: 'NIT',
      name: row.issuerName || row.issuerNit,
      commercialName: row.issuerName || row.issuerNit,
    },
    invoice: {
      cufe: row.cufe,
      prefix: row.prefix || undefined,
      number: invoiceNumber,
      issueDate,
      currency: row.currency || 'COP',
    },
    items: [
      {
        descripcion: 'Factura electrónica recibida',
        cantidad: 1,
        valorUnitario: subtotal > 0 ? subtotal : total,
        total: subtotal > 0 ? subtotal : total,
      },
    ],
    taxes: iva > 0 ? [{ type: 'IVA', amount: iva }] : [],
    totals: {
      subtotal: subtotal > 0 ? subtotal : total,
      total,
      iva,
    },
  };
}
