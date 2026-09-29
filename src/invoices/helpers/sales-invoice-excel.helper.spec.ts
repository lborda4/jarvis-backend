import * as XLSX from 'xlsx';
import { EXCEL_COLUMNS } from '../../common/constants/excel.constants';
import {
  mapDianSalesInvoiceRowToPayload,
  parseDianSalesInvoiceExcel,
} from './sales-invoice-excel.helper';
import { validatePurchaseInvoiceExcelRows } from './purchase-invoice-import-validation.helper';

const SUPPORTED_TYPES = [
  'Factura electrónica',
  'Factura electrónica de contingencia',
  'POS electrónico',
  'Documento equivalente POS',
  'Tiquete aéreo',
  'Documento equivalente - Transporte aéreo de pasajeros',
  'Tiquete transporte pasajeros',
];

function excelBuffer(entries: Array<{ type: string; group?: string }>): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    [
      EXCEL_COLUMNS.DOCUMENT_TYPE, EXCEL_COLUMNS.GROUP, EXCEL_COLUMNS.CUFE,
      EXCEL_COLUMNS.ISSUER_NIT, EXCEL_COLUMNS.ISSUER_NAME, EXCEL_COLUMNS.TOTAL,
      EXCEL_COLUMNS.IVA, EXCEL_COLUMNS.PREFIX, EXCEL_COLUMNS.FOLIO,
      EXCEL_COLUMNS.ISSUE_DATE,
    ],
    ...entries.map(({ type, group = 'Recibido' }, index) => [
      type, group, `cufe-cude-${index}`, '900123456', 'Proveedor SAS',
      119000, 19000, 'F', String(index + 1), '28-09-2026',
    ]),
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'DIAN');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('tipos recibidos del Excel DIAN para facturas de compra', () => {
  it.each(SUPPORTED_TYPES)('importa %s con el mismo payload de compra', (type) => {
    const result = parseDianSalesInvoiceExcel(excelBuffer([{ type }]));
    expect(result.processedRows).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].documentType).toBe(type);
    expect(validatePurchaseInvoiceExcelRows(result.rows)).toMatchObject({
      totalRows: 1, validRows: 1, invalidRows: 0,
    });
    expect(mapDianSalesInvoiceRowToPayload(result.rows[0])).toMatchObject({
      supplier: { documentNumber: '900123456', name: 'Proveedor SAS' },
      invoice: { cufe: 'cufe-cude-0', number: 'F1', issueDate: '2026-09-28' },
      totals: { subtotal: 100000, total: 119000, iva: 19000 },
    });
  });

  it.each(SUPPORTED_TYPES)('excluye %s cuando es Emitido', (type) => {
    expect(parseDianSalesInvoiceExcel(
      excelBuffer([{ type, group: 'Emitido' }]),
    ).rows).toEqual([]);
  });

  it.each(SUPPORTED_TYPES)('normaliza tildes, mayúsculas y espacios de %s', (type) => {
    const variant = type.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/ /g, '  ');
    expect(parseDianSalesInvoiceExcel(
      excelBuffer([{ type: `  ${variant}  `, group: '  RECIBIDO  ' }]),
    ).rows).toHaveLength(1);
  });

  it.each([
    'Nota crédito', 'Nota débito', 'Documento soporte', '',
    'Factura electrónica desconocida', 'Tiquete transporte carga',
    'Documento equivalente - Transporte aéreo de carga',
    'Documento equivalente - Transporte aéreo de pasajeros - Nota de ajuste',
    'Nota de ajuste - Documento equivalente - Transporte aéreo de pasajeros',
    'Documento equivalente - Servicios públicos',
    'Nota de ajuste - Documento equivalente POS',
    'Documento equivalente POS - Nota de ajuste',
  ])('excluye tipos no admitidos: %s', (type) => {
    expect(parseDianSalesInvoiceExcel(excelBuffer([{ type }])).rows).toEqual([]);
  });

  it.each(['-', '–', '—', '‑'])('admite el separador %s en el nombre DIAN', (separator) => {
    const type = `Documento equivalente${separator}Transporte aéreo de pasajeros`;
    const { rows } = parseDianSalesInvoiceExcel(excelBuffer([{ type }]));
    expect(rows).toHaveLength(1);
    expect(rows[0].documentType).toBe(type);
  });

  it('filtra un Excel mixto y conserva el conteo de todas las filas leídas', () => {
    const result = parseDianSalesInvoiceExcel(excelBuffer([
      ...SUPPORTED_TYPES.map((type) => ({ type })),
      { type: 'Nota crédito' },
      { type: 'POS electrónico', group: 'Emitido' },
      { type: 'Tiquete aéreo', group: '' },
    ]));
    expect(result.processedRows).toBe(SUPPORTED_TYPES.length + 3);
    expect(result.rows.map((row) => row.documentType)).toEqual(SUPPORTED_TYPES);
    expect(result.rows.map((row) => row.cufe)).toEqual(
      SUPPORTED_TYPES.map((_, index) => `cufe-cude-${index}`),
    );
  });
});
