import { buildJarvisInvoiceChargeTaxTotals } from './jarvis-invoice-tax.helper';

describe('impuestos cargo de factura de venta', () => {
  it('conserva tipo y tarifa distintos y agrupa solo líneas compatibles', () => {
    const totals = buildJarvisInvoiceChargeTaxTotals([
      { taxId: 1, taxAmount: 19, quantity: 1, unitValue: 100, discount: 0 },
      { taxId: 1, taxAmount: 38, quantity: 2, unitValue: 100, discount: 0 },
      { taxId: 1, taxAmount: 5, quantity: 1, unitValue: 100, discount: 0 },
      { taxId: 4, taxAmount: 8, quantity: 1, unitValue: 120, discount: 20 },
      { taxId: 1, taxAmount: 0, quantity: 1, unitValue: 100, discount: 0 },
    ]);
    expect(totals).toEqual([
      { tax_id: 1, tax_amount: '57.00', taxable_amount: '300.00', percent: '19.00' },
      { tax_id: 1, tax_amount: '5.00', taxable_amount: '100.00', percent: '5.00' },
      { tax_id: 4, tax_amount: '8.00', taxable_amount: '100.00', percent: '8.00' },
    ]);
  });

  it('incluye IVA 0% cuando se pide (DSAU04 en documento soporte)', () => {
    expect(
      buildJarvisInvoiceChargeTaxTotals(
        [{ taxId: 1, taxAmount: 0, quantity: 1, unitValue: 150000, discount: 0 }],
        { includeZeroAmount: true },
      ),
    ).toEqual([
      { tax_id: 1, tax_amount: '0.00', taxable_amount: '150000.00', percent: '0.00' },
    ]);
  });
});
