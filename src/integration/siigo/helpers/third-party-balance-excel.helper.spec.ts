import * as XLSX from 'xlsx';
import { parseThirdPartyBalanceExcel } from './third-party-balance-excel.helper';

function buildWorkbookBuffer(rows: Array<Array<string | number>>): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Balance');
  const output: unknown = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  });

  if (!Buffer.isBuffer(output)) {
    throw new Error('No se pudo construir el Excel de prueba.');
  }

  return output;
}

describe('parseThirdPartyBalanceExcel', () => {
  it('extrae y deduplica tercero/cuenta, incluyendo cuentas agrupadas', () => {
    const buffer = buildWorkbookBuffer([
      ['Balance de prueba por tercero'],
      ['Código cuenta contable', 'Identificación tercero', 'Nombre'],
      ['51359501', '900.123.456', 'Proveedor uno'],
      ['', '901234567', 'Proveedor dos'],
      ['51359501', '900123456', 'Proveedor uno repetido'],
      ['24080501', '800123456', 'Cuenta de pasivo no sugerible'],
    ]);

    expect(parseThirdPartyBalanceExcel(buffer)).toEqual([
      { supplierDocument: '900123456', accountCode: '51359501' },
      { supplierDocument: '901234567', accountCode: '51359501' },
    ]);
  });

  it('acepta alias de encabezados y conserva cuentas de clases 5, 6 y 7', () => {
    const buffer = buildWorkbookBuffer([
      ['Cuenta', 'NIT'],
      ['5105-05-01', '9001'],
      ['6135 05 01', '9002'],
      ['71050501', '9003'],
    ]);

    expect(parseThirdPartyBalanceExcel(buffer)).toEqual([
      { supplierDocument: '9001', accountCode: '51050501' },
      { supplierDocument: '9002', accountCode: '61350501' },
      { supplierDocument: '9003', accountCode: '71050501' },
    ]);
  });

  it('falla claramente cuando SIIGO cambia las columnas del reporte', () => {
    const buffer = buildWorkbookBuffer([
      ['Columna desconocida', 'Otra columna'],
      ['51359501', '900123456'],
    ]);

    expect(() => parseThirdPartyBalanceExcel(buffer)).toThrow(
      'No se encontraron las columnas de identificación del tercero y cuenta contable',
    );
  });
});
