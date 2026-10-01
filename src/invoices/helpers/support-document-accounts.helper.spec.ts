import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { buildSupportDocumentTemplateExcel } from './support-document-template.helper';
import { parseSupportDocumentExcel } from './support-document-excel.helper';
import { applySupportDocumentExcelAccounts } from './support-document-accounts.helper';
import { mapGroupedSupportDocumentToPayload } from '../../electronic-document/mappers/support-document-excel-to-payload.mapper';
import { validateSupportDocumentExcelRows } from './support-document-import-validation.helper';

const accounts = [{ code: '61601013', name: 'Valoraciones' }, { code: '513595', name: 'Servicios' }];
function excel(values: Array<string | number | undefined>, includeColumn = true) {
  const rows = [['Fecha', 'Tipo de documento', 'Numero de documento', 'Prefijo', 'Consecutivo', 'Descripcion', 'Cantidad', 'Valor unitario', ...(includeColumn ? ['Cuenta contable'] : [])],
    ...values.map((value) => ['01/10/2026', 'CC', '12345678', 'DS', '1', 'Misma descripción', 1, 100, ...(includeColumn ? [value ?? ''] : [])])];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Datos');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

describe('Cuenta contable por línea del Excel de documento soporte', () => {
  it('la plantilla incluye catálogo y desplegable sin preseleccionar cuentas', async () => {
    const buffer = await buildSupportDocumentTemplateExcel([], accounts);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as any);
    const sheet = book.worksheets[0];
    const headers = sheet.getRow(1).values as string[];
    const column = headers.indexOf('Cuenta contable');
    expect(column).toBeGreaterThan(0);
    expect(sheet.getCell(2, column).value).toBeNull();
    expect(sheet.getCell(2, column).dataValidation.formulae).toEqual(['CuentasContables!$A$1:$A$2']);
    expect(book.getWorksheet('CuentasContables')!.getCell('A1').value).toBe('61601013 - Valoraciones');
  });
  it('preserva cuentas diferentes aunque los ítems tengan la misma descripción', () => {
    const groups = parseSupportDocumentExcel(excel(['61601013 - Nombre viejo', 513595, '']));
    applySupportDocumentExcelAccounts(groups, accounts);
    const items = mapGroupedSupportDocumentToPayload(groups[0]).items;
    expect(items.map((item) => item.accountMapping)).toEqual([
      { code: '61601013', description: 'Valoraciones' }, { code: '513595', description: 'Servicios' }, undefined,
    ]);
  });
  it('rechaza una cuenta ajena al catálogo de la empresa antes de mapear el lote', () => {
    const groups = parseSupportDocumentExcel(excel(['61601013', '999999']));
    expect(validateSupportDocumentExcelRows(groups, [], accounts).invalidGroups).toBe(1);
    expect(() => applySupportDocumentExcelAccounts(groups, accounts)).toThrow('999999');
    expect(groups[0].rows[0].accountMapping).toBeUndefined();
  });
  it('las plantillas anteriores y las celdas vacías conservan el flujo de sugerencias', () => {
    for (const buffer of [excel(['']), excel([''], false)]) {
      const groups = parseSupportDocumentExcel(buffer);
      applySupportDocumentExcelAccounts(groups, accounts);
      expect(mapGroupedSupportDocumentToPayload(groups[0]).items[0].accountMapping).toBeUndefined();
    }
  });
});
