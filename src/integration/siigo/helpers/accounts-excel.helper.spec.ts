import * as XLSX from 'xlsx';
import { fixWorksheetRange, parseAccountsExcel } from './accounts-excel.helper';

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

  it('reconoce encabezados con NBSP o salto de línea entre palabras — caso real reportado: el Excel real de SIIGO rechazado con "columnas requeridas no encontradas" aunque el encabezado se viera correcto', () => {
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
        // NBSP entre palabras en vez de espacio normal.
        'Maneja vencimientos',
        'Diferencia fiscal',
        'Activo',
        // Salto de línea (celda con ajuste de texto) en vez de espacio.
        'Nivel\nagrupación',
      ],
      validRow(),
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(matrix),
      'Cuentas',
    );

    const result = parseAccountsExcel(
      XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    );

    expect(result.rows).toEqual([
      { accountCode: '11050501', accountName: 'Caja general' },
    ]);
  });

  it('lee un archivo real de SIIGO que en realidad es texto plano separado por tabs con extensión .xlsx (no un binario OOXML) — caso real reportado: sin decodificar como UTF-8, "Código" y "Nivel agrupación" quedaban con tildes rotas y el archivo se rechazaba con "columnas requeridas no encontradas"', () => {
    const text = [
      'Cuentas contables',
      'MAGNA FILIA SAS',
      '901464201-3',
      '',
      '',
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
      ].join('\t'),
      ['1', 'Activo'].join('\t'),
      validRow().join('\t'),
    ].join('\n');

    const result = parseAccountsExcel(Buffer.from(text, 'utf8'));

    expect(result.rows).toEqual([
      { accountCode: '11050501', accountName: 'Caja general' },
    ]);
  });

  describe('fixWorksheetRange', () => {
    it('recalcula "!ref" a partir de las celdas reales cuando el archivo declara un rango truncado — caso real reportado: el export de SIIGO trae las celdas de Nombre/Activo/Nivel agrupación con sus valores correctos, pero el "!ref" del archivo decía "A1:A1091" como si esas columnas no existieran, y sheet_to_json las descartaba todas', () => {
      const sheet = XLSX.utils.aoa_to_sheet([
        ['Código', 'Nombre', 'Activo'],
        ['11050501', 'Caja general', 'Sí'],
      ]);

      // Simula el bug real: el archivo dice que solo existe la columna A,
      // aunque las celdas de las demás columnas sigan ahí con sus valores.
      sheet['!ref'] = 'A1:A2';

      fixWorksheetRange(sheet);

      expect(sheet['!ref']).toBe('A1:C2');

      const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        defval: '',
        raw: false,
      });
      expect(matrix[0]).toEqual(['Código', 'Nombre', 'Activo']);
      expect(matrix[1]).toEqual(['11050501', 'Caja general', 'Sí']);
    });

    it('no hace nada con una hoja vacía (sin celdas)', () => {
      const sheet: XLSX.WorkSheet = { '!ref': 'A1:A1' };

      fixWorksheetRange(sheet);

      expect(sheet['!ref']).toBe('A1:A1');
    });
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
