import fixture from './fixtures/nextpyme-mixed-tax-bases.json';
import { mapNextPymeInvoiceQueryToElectronicDocumentPayload as map } from './nextpyme-invoice-query-to-payload.mapper';
import { NextPymeInvoiceQueryResult } from '../../integration/jarvis/nextpyme/nextpyme-api.client';

function source() {
  return { ...structuredClone(fixture), seller: { identification_number: '123', name: 'Proveedor' }, date: '2026-05-03' } as NextPymeInvoiceQueryResult;
}

describe('Subtotal con bases gravadas y líneas sin IVA', () => {
  it('conserva subtotal, IVA, total y tarifas por ítem de la factura de 83 líneas', () => {
    const payload = map(source(), 'test');
    expect(payload.totals.subtotal).toBe(2332594.54);
    expect(payload.totals.iva).toBe(194733.46);
    expect(payload.totals.total).toBe(2527328);
    expect(payload.items).toHaveLength(83);
    expect(payload.items[0].ivaPercentage).toBe(5);
    expect(payload.items[1].ivaPercentage).toBe(19);
    expect(payload.items[4].ivaPercentage).toBeUndefined();
    expect(payload.items[52]).toMatchObject({ cantidad: 0.58, valorUnitario: 19000, total: 10925 });
  });
  it('no sustituye el subtotal si las líneas no respaldan el importe alternativo', () => {
    const data = source();
    data.invoice_lines[0].line_extension_amount = '1.00';
    expect(map(data, 'test').totals.subtotal).toBe(1293916.54);
  });
});
