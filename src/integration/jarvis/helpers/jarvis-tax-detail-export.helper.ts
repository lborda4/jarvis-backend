import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { REPORT_TAX_FILTERS, type ReportColumn, type ReportFilters, type ReportRow } from '../jarvis-reports.types';

export function addTaxDetailSheet(
  book: Workbook,
  company: { name: string; nit: string },
  filters: ReportFilters,
  columns: ReportColumn[],
  rows: ReportRow[],
  totals: ReportRow[],
  warnings: string[],
): void {
  const headerRow = 8;
  const requiredRows = headerRow + totals.length + rows.length + warnings.length + 3;
  if (requiredRows > 1048576)
    throw new BadRequestException('El reporte supera el límite de filas de una hoja de Excel. Reduce el rango o los filtros.');

  const sheet = book.addWorksheet('Impuestos detallados');
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.format === 'text' ? 26 : 20;
    if (column.format !== 'text')
      sheet.getColumn(index + 1).numFmt = column.format === 'money' ? '#,##0.00;[Red]-#,##0.00' : '#,##0.######';
  });
  const headings = [
    'Informe impuestos detallados',
    company.name,
    company.nit,
    `Del ${filters.from} al ${filters.to}`,
    `Impuesto: ${REPORT_TAX_FILTERS.find(option => option.value === filters.tax)?.label ?? 'Todos'} · Moneda: ${filters.currency || 'Todas'}`,
  ];
  headings.forEach((value, index) => {
    const row = sheet.getRow(index + 2);
    sheet.mergeCells(index + 2, 1, index + 2, columns.length);
    row.getCell(1).value = value;
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF087F84' } };
    row.height = 20;
  });
  sheet.getRow(headerRow).values = columns.map(column => column.label);
  const header = sheet.getRow(headerRow);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F4F9' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 32;

  totals.forEach(total => {
    const row = sheet.addRow(columns.map((column, index) =>
      index === 0 ? `Total · ${String(total.currency ?? '')}` : column.format !== 'text' ? total[column.key] ?? null : null,
    ));
    row.font = { bold: true };
  });
  rows.forEach(item => sheet.addRow(columns.map(column => item[column.key] ?? null)));
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  sheet.addRow([]);
  const addNote = (value: string) => {
    const row = sheet.addRow([value]);
    sheet.mergeCells(row.number, 1, row.number, columns.length);
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = 30;
  };
  addNote(`Filtros: búsqueda ${filters.search || 'Todas'}; tercero ${filters.customer || 'Todos'}; vendedor ${filters.seller || 'Todos'}; tipo ${filters.kind || 'Todos'}`);
  warnings.forEach(addNote);
}
