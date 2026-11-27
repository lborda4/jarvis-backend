import { BadRequestException } from '@nestjs/common';
import { Workbook, type Worksheet } from 'exceljs';
import type {
  ReportColumn,
  ReportFilters,
  ReportRow,
} from '../jarvis-reports.types';

const customerColumns: ReportColumn[] = [
  { key: 'customerType', label: 'Tipo de identificación', format: 'text' },
  { key: 'customerId', label: 'Identificación', format: 'text' },
  { key: 'customerName', label: 'Cliente', format: 'text' },
  { key: 'currency', label: 'Moneda', format: 'text' },
  { key: 'documentCount', label: 'Número de comprobantes', format: 'number' },
  { key: 'subtotal', label: 'Subtotal', format: 'money' },
  {
    key: 'discount',
    label: 'Descuento posterior a impuestos',
    format: 'money',
  },
  { key: 'netSales', label: 'Valor neto antes de impuestos', format: 'money' },
  { key: 'taxesCharged', label: 'Impuestos a cargo', format: 'money' },
  { key: 'taxesRetained', label: 'Impuestos de retención', format: 'money' },
  { key: 'total', label: 'Valor total', format: 'money' },
  { key: 'payable', label: 'Total después de retenciones', format: 'money' },
];

const sellerColumns: ReportColumn[] = [
  { key: 'seller', label: 'Nombre vendedor', format: 'text' },
  { key: 'currency', label: 'Moneda', format: 'text' },
  { key: 'documentCount', label: 'Número de comprobantes', format: 'number' },
  { key: 'subtotal', label: 'Subtotal', format: 'money' },
  {
    key: 'discount',
    label: 'Descuento posterior a impuestos',
    format: 'money',
  },
  { key: 'netSales', label: 'Valor neto antes de impuestos', format: 'money' },
  { key: 'taxesCharged', label: 'Impuestos a cargo', format: 'money' },
  { key: 'taxesRetained', label: 'Impuestos de retención', format: 'money' },
  { key: 'total', label: 'Valor total', format: 'money' },
  { key: 'payable', label: 'Total después de retenciones', format: 'money' },
  {
    key: 'participation',
    label: 'Participación en ventas netas (%)',
    format: 'percent',
  },
];

const productColumns: ReportColumn[] = [
  { key: 'productCode', label: 'Código producto', format: 'text' },
  { key: 'productName', label: 'Nombre producto', format: 'text' },
  { key: 'currency', label: 'Moneda', format: 'text' },
  { key: 'soldQuantity', label: 'Cantidad vendida', format: 'number' },
  { key: 'returnedQuantity', label: 'Cantidad devuelta', format: 'number' },
  { key: 'debitQuantity', label: 'Cantidad notas débito', format: 'number' },
  { key: 'netQuantity', label: 'Cantidad neta', format: 'number' },
  { key: 'subtotal', label: 'Subtotal', format: 'money' },
  {
    key: 'discount',
    label: 'Descuento posterior a impuestos',
    format: 'money',
  },
  { key: 'netSales', label: 'Valor neto antes de impuestos', format: 'money' },
  { key: 'taxesCharged', label: 'Impuestos a cargo', format: 'money' },
  { key: 'taxesRetained', label: 'Impuestos de retención', format: 'money' },
  { key: 'total', label: 'Valor total', format: 'money' },
  { key: 'payable', label: 'Total después de retenciones', format: 'money' },
];

function sumKnown(row: ReportRow, keys: string[]): number | null {
  const values = keys.map((key) => row[key]);
  if (
    values.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  )
    return null;
  return (
    Math.round(
      values.reduce<number>((sum, value) => sum + Number(value), 0) * 100,
    ) / 100
  );
}

function groupValues(row: ReportRow): ReportRow {
  return {
    ...row,
    documentCount: sumKnown(row, ['invoiceCount', 'creditCount', 'debitCount']),
    taxesCharged: sumKnown(row, ['iva', 'otherTaxes']),
    taxesRetained: sumKnown(row, ['retefuente', 'reteIca', 'reteIva']),
  };
}

function addHeader(
  sheet: Worksheet,
  rowNumber: number,
  columns: ReportColumn[],
): void {
  const row = sheet.getRow(rowNumber);
  row.values = columns.map((column) => column.label);
  row.font = { bold: true };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F4F9' },
  };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 32;
}

function addValues(
  sheet: Worksheet,
  columns: ReportColumn[],
  data: ReportRow,
  total = false,
): void {
  const row = sheet.addRow(
    columns.map((column, index) =>
      total && index === 0
        ? `Total · ${String(data.currency ?? '')}`
        : total && column.format === 'text'
          ? null
          : (data[column.key] ?? null),
    ),
  );
  if (total) row.font = { bold: true };
  columns.forEach((column, index) => {
    if (column.format === 'money')
      row.getCell(index + 1).numFmt = '#,##0.00;[Red]-#,##0.00';
    else if (column.format === 'percent')
      row.getCell(index + 1).numFmt = '0.00"%"';
    else if (column.format === 'number')
      row.getCell(index + 1).numFmt = '#,##0.######';
  });
}

function addGroupedReportSheet(
  book: Workbook,
  company: { name: string; nit: string },
  filters: ReportFilters,
  summary: ReportRow[],
  detail: ReportRow[],
  detailColumns: ReportColumn[],
  totals: ReportRow[],
  warnings: string[],
  title: string,
  columns: ReportColumn[],
): void {
  const includeDetail = filters.view === 'detail';
  const requiredRows =
    7 +
    summary.length +
    totals.length +
    (includeDetail ? detail.length + 3 : 0) +
    (warnings.length ? warnings.length + 1 : 0);
  if (requiredRows > 1048576)
    throw new BadRequestException(
      'El reporte supera el límite de filas de una hoja de Excel. Reduce el rango o los filtros.',
    );
  const sheet = book.addWorksheet(title);
  const width = Math.max(
    columns.length,
    includeDetail ? detailColumns.length : 0,
  );
  for (let index = 1; index <= width; index++)
    sheet.getColumn(index).width = 23;
  sheet.getColumn(3).width = 35;
  [
    title,
    company.name,
    company.nit,
    `Del ${filters.from} al ${filters.to}`,
  ].forEach((value, index) => {
    const row = sheet.getRow(index + 2);
    sheet.mergeCells(row.number, 1, row.number, width);
    row.getCell(1).value = value;
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF087F84' },
    };
    row.height = 20;
  });
  addHeader(sheet, 7, columns);
  summary.forEach((row) => addValues(sheet, columns, groupValues(row)));
  totals.forEach((row) => addValues(sheet, columns, groupValues(row), true));
  if (includeDetail) {
    sheet.addRow([]);
    const title = sheet.addRow(['Detalle de comprobantes']);
    title.font = { bold: true };
    addHeader(sheet, sheet.rowCount + 1, detailColumns);
    detail.forEach((row) => addValues(sheet, detailColumns, row));
  }
  if (warnings.length) sheet.addRow([]);
  const addNote = (value: string) => {
    const row = sheet.addRow([value]);
    sheet.mergeCells(row.number, 1, row.number, width);
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = 30;
  };
  warnings.forEach(addNote);
  sheet.views = [{ state: 'frozen', ySplit: 7 }];
}

export function addCustomerReportSheet(
  book: Workbook,
  company: { name: string; nit: string },
  filters: ReportFilters,
  summary: ReportRow[],
  detail: ReportRow[],
  detailColumns: ReportColumn[],
  totals: ReportRow[],
  warnings: string[],
): void {
  addGroupedReportSheet(
    book,
    company,
    filters,
    summary,
    detail,
    detailColumns,
    totals,
    warnings,
    'Ventas por cliente',
    customerColumns,
  );
}

export function addSellerReportSheet(
  book: Workbook,
  company: { name: string; nit: string },
  filters: ReportFilters,
  summary: ReportRow[],
  detail: ReportRow[],
  detailColumns: ReportColumn[],
  totals: ReportRow[],
  warnings: string[],
): void {
  addGroupedReportSheet(
    book,
    company,
    filters,
    summary,
    detail,
    detailColumns,
    totals,
    warnings,
    'Ventas por vendedor',
    sellerColumns,
  );
}

export function addProductReportSheet(
  book: Workbook,
  company: { name: string; nit: string },
  filters: ReportFilters,
  summary: ReportRow[],
  detail: ReportRow[],
  detailColumns: ReportColumn[],
  totals: ReportRow[],
  warnings: string[],
): void {
  addGroupedReportSheet(
    book,
    company,
    filters,
    summary,
    detail,
    detailColumns,
    totals,
    warnings,
    'Ventas por producto',
    productColumns,
  );
}
