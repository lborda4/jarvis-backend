import { DianSalesInvoiceRow } from './sales-invoice-excel.helper';
import { validatePurchaseInvoiceExcelRows } from './purchase-invoice-import-validation.helper';

function buildRow(overrides: Partial<DianSalesInvoiceRow> = {}): DianSalesInvoiceRow {
  return {
    cufe: 'cufe-1',
    documentType: 'Factura electrónica',
    folio: '1',
    prefix: 'SETP',
    currency: 'COP',
    paymentForm: '1',
    paymentMethod: '10',
    issueDate: '01-08-2026',
    receptionDate: '01-08-2026',
    issuerNit: '900123456',
    issuerName: 'Proveedor SAS',
    receiverNit: '800123456',
    receiverName: 'Empresa Receptora',
    iva: 0,
    total: 100000,
    status: 'Vigente',
    group: 'Recibido',
    ...overrides,
  };
}

describe('validatePurchaseInvoiceExcelRows', () => {
  it('no reporta errores para filas bien formadas', () => {
    const report = validatePurchaseInvoiceExcelRows([
      buildRow({ cufe: 'cufe-1' }),
      buildRow({ cufe: 'cufe-2' }),
    ]);

    expect(report).toEqual({
      totalRows: 2,
      validRows: 2,
      invalidRows: 0,
      errors: [],
    });
  });

  it('reporta CUFE faltante', () => {
    const report = validatePurchaseInvoiceExcelRows([buildRow({ cufe: '' })]);

    expect(report.invalidRows).toBe(1);
    expect(report.errors).toEqual([
      expect.objectContaining({ rowIndex: 1, reason: 'Falta el CUFE.' }),
    ]);
  });

  it('reporta CUFEs duplicados dentro del mismo archivo, apuntando a la primera fila donde apareció', () => {
    const report = validatePurchaseInvoiceExcelRows([
      buildRow({ cufe: 'cufe-repetido' }),
      buildRow({ cufe: 'cufe-repetido' }),
    ]);

    expect(report.invalidRows).toBe(1);
    expect(report.errors).toEqual([
      expect.objectContaining({
        rowIndex: 2,
        cufe: 'cufe-repetido',
        reason: 'CUFE duplicado — ya aparece en la fila 1.',
      }),
    ]);
  });

  it('reporta NIT del emisor faltante o con formato inválido', () => {
    const report = validatePurchaseInvoiceExcelRows([
      buildRow({ cufe: 'cufe-1', issuerNit: '' }),
      buildRow({ cufe: 'cufe-2', issuerNit: '123' }),
    ]);

    expect(report.invalidRows).toBe(2);
    expect(report.errors).toEqual([
      expect.objectContaining({ rowIndex: 1, reason: 'Falta el NIT del emisor.' }),
      expect.objectContaining({
        rowIndex: 2,
        reason: 'NIT del emisor con formato inválido (123).',
      }),
    ]);
  });

  it('reporta nombre del emisor faltante', () => {
    const report = validatePurchaseInvoiceExcelRows([
      buildRow({ cufe: 'cufe-1', issuerName: '' }),
    ]);

    expect(report.invalidRows).toBe(1);
    expect(report.errors).toEqual([
      expect.objectContaining({ rowIndex: 1, reason: 'Falta el nombre del emisor.' }),
    ]);
  });

  it('una fila puede acumular varios errores a la vez', () => {
    const report = validatePurchaseInvoiceExcelRows([
      buildRow({ cufe: '', issuerNit: '', issuerName: '' }),
    ]);

    expect(report.invalidRows).toBe(1);
    expect(report.errors).toHaveLength(3);
  });

  it('lote vacío: sin filas, sin errores', () => {
    expect(validatePurchaseInvoiceExcelRows([])).toEqual({
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      errors: [],
    });
  });
});
