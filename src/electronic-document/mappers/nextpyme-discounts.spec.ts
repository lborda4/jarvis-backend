import fixture from './fixtures/nextpyme-discounts.json';
import { mapNextPymeInvoiceQueryToElectronicDocumentPayload } from './nextpyme-invoice-query-to-payload.mapper';
import { NextPymeInvoiceQueryResult } from '../../integration/jarvis/nextpyme/nextpyme-api.client';
import { mapCreatePurchaseSendRequestToSiigo } from '../../integration/siigo/mappers/create-siigo-purchase-send-request.mapper';

describe('Response Nextpyme con descuentos por línea', () => {
  it('conserva los precios, descuentos y bases del documento sin convertirlos en descuento general', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(fixture as unknown as NextPymeInvoiceQueryResult, 'test');
    expect(payload.items).toHaveLength(12);
    payload.items.forEach((item, index) => {
      const original = fixture.invoice_lines[index];
      expect(item.valorUnitario).toBe(Number(original.price_amount));
      expect(item.total).toBe(Number(original.line_extension_amount));
      expect(item.discount ?? 0).toBe(original.allowance_charges.reduce((sum, c) => sum + Number(c.amount), 0));
      expect(item.ivaPercentage).toBe(19);
      expect(item.accountMapping).toBeUndefined();
    });
    expect(payload.totals).toEqual({ subtotal: 407823.53, iva: 77486.47, total: 485310 });
  });

  it('envía las 12 bases con descuentos por valor sin generar cuentas ni redondear cada línea a pesos', () => {
    const items = fixture.invoice_lines.map(line => {
      const price = Number(line.price_amount);
      return {
        type: 'Account' as const, code: '5105', description: line.description, quantity: 1, price,
        ...(line.allowance_charges.length ? { discount: Number(line.allowance_charges[0].amount) } : {}),
        taxes: [{ id: 19 }],
      };
    });
    const result = mapCreatePurchaseSendRequestToSiigo({
      documentId: 'test', date: '2026-08-23', supplier: { identification: '900123456' }, tax_included: true,
      provider_invoice: { prefix: 'CS03', number: '9895' }, items, payments: [{ id: 1, value: 485310 }],
    }, 1, [{ id: 19, name: 'IVA 19%', percentage: 19, type: 'IVA', active: true }]);
    expect(result.items).toEqual(items);
    expect(result.discount_type).toBe('Value');
    expect(result.tax_included).toBe(true);
    expect(result.payments[0].value).toBe(485310);
  });
});
