import * as XLSX from 'xlsx';
import { parseAccountsExcel } from './accounts-excel.helper';

/** Arma un Excel con el mismo formato del archivo real: bloque de título
 * (nombre del reporte, razón social, NIT) antes de la fila de encabezados. */
function buildWorkbookBuffer(dataRows: string[][]): Buffer {
  const matrix = [
    ['Cuentas contables'],
    ['MAGNA FILIA SAS'],
    ['901464201'],
    [
      'Código',
      'Nombre',
      'Categoría',
      'Clase',
      'Relación con',
      'Maneja vencimientos',
      'Diferencia fiscal',
      'Activo',
      'Nivel agrupación',
    ],
    ...dataRows,
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(matrix),
    'Cuentas',
  );

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Fila que cumple TODOS los filtros; cada test cambia solo lo que prueba. */
function validRow(overrides: Partial<Record<number, string>> = {}): string[] {
  const row = [
    '11050501',
    'Caja general',
    'Caja - Bancos',
    'Activo',
    'Formas de pago',
    'No maneja vencimiento',
    'No',
    'Sí',
    'Transaccional',
  ];

  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value as string;
  }

  return row;
}

describe('parseAccountsExcel', () => {
  it('guarda la cuenta que cumple los cuatro filtros', () => {
    const result = parseAccountsExcel(buildWorkbookBuffer([validRow()]));

    expect(result.rows).toEqual([
      { accountCode: '11050501', accountName: 'Caja general' },
    ]);
    expect(result.skippedRows).toBe(0);
  });

  it('descarta las cuentas de agrupación (sin nivel transaccional)', () => {
    // Así vienen en el archivo las cuentas de jerarquía del PUC: "1",
    // "11", "1105"... sin categoría, sin nivel y sin marca de activo.
    const result = parseAccountsExcel(
      buildWorkbookBuffer([
        ['1', 'Activo', '', '', '', '', '', '', ''],
        ['1105', 'Caja', '', '', '', '', '', '', ''],
        validRow(),
      ]),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.skippedRows).toBe(2);
  });

  it('solo acepta las clases 1, 2, 5, 6 y 7', () => {
    const result = parseAccountsExcel(
      buildWorkbookBuffer([
        validRow({ 0: '11050501' }),
        validRow({ 0: '22050501' }),
        validRow({ 0: '33050501' }), // Patrimonio
        validRow({ 0: '41050501' }), // Ingresos
        validRow({ 0: '51050501' }),
        validRow({ 0: '61050501' }),
        validRow({ 0: '71050501' }),
        validRow({ 0: '81050501' }), // Cuentas de orden
      ]),
    );

    expect(result.rows.map((row) => row.accountCode)).toEqual([
      '11050501',
      '22050501',
      '51050501',
      '61050501',
      '71050501',
    ]);
    expect(result.skippedRows).toBe(3);
  });

  it('descarta las que manejan vencimiento, las inactivas y las no transaccionales', () => {
    const result = parseAccountsExcel(
      buildWorkbookBuffer([
        validRow({ 0: '11050502', 5: 'Maneja vencimiento' }),
        validRow({ 0: '11050503', 7: 'No' }),
        validRow({ 0: '11050504', 8: 'Agrupación' }),
        validRow(),
      ]),
    );

    expect(result.rows.map((row) => row.accountCode)).toEqual(['11050501']);
    expect(result.skippedRows).toBe(3);
  });

  it('no repite una cuenta que venga dos veces en el archivo', () => {
    const result = parseAccountsExcel(
      buildWorkbookBuffer([validRow(), validRow()]),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.skippedRows).toBe(1);
  });

  it('falla con un mensaje claro si el archivo no trae las columnas esperadas', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['Otra cosa'], ['1', 'Activo']]),
      'Cuentas',
    );

    expect(() =>
      parseAccountsExcel(
        XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      ),
    ).toThrow(/columnas requeridas/i);
  });
});
