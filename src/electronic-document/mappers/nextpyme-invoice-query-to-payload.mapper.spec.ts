import { NextPymeInvoiceQueryResult } from '../../integration/jarvis/nextpyme/nextpyme-api.client';
import { mapNextPymeInvoiceQueryToElectronicDocumentPayload } from './nextpyme-invoice-query-to-payload.mapper';

function buildResult(
  overrides: Partial<NextPymeInvoiceQueryResult> = {},
): NextPymeInvoiceQueryResult {
  return {
    prefix: 'SETP',
    number: '990000001',
    date: '2026-07-21',
    seller: {
      identification_number: '902086460',
      name: 'JARVIS COLOMBIA S.A.S',
      type_identification: '31',
    },
    legal_monetary_totals: {
      line_extension_amount: '100000.00',
      payable_amount: '100000.00',
    },
    invoice_lines: [
      {
        invoiced_quantity: '1.000000',
        line_extension_amount: '100000.00',
        description: 'PRODUCTO DE PRUEBA',
        price_amount: '100000.00',
      },
    ],
    ...overrides,
  };
}

describe('mapNextPymeInvoiceQueryToElectronicDocumentPayload', () => {
  it('maps totals, items and supplier from a well-formed response', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult(),
      'cufe-123',
    );

    expect(payload.totals).toEqual({ subtotal: 100000, total: 100000, iva: 0 });
    expect(payload.supplier.documentNumber).toBe('902086460');
    expect(payload.supplier.documentType).toBe('NIT');
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].descripcion).toBe('PRODUCTO DE PRUEBA');
  });

  it.each([
    ['31', 'NIT'],
    ['13', 'CC'],
    ['21', 'CE'],
    ['22', 'CE'],
    ['41', 'PA'],
    ['42', 'PA'],
    ['99', 'NIT'],
    [undefined, 'NIT'],
  ])('maps DIAN type_identification %s to %s', (code, expected) => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        seller: {
          identification_number: '123',
          name: 'Proveedor',
          type_identification: code,
        },
      }),
      'cufe-123',
    );

    expect(payload.supplier.documentType).toBe(expected);
  });

  it('carries the item-level IVA percentage from the first tax_totals entry', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        invoice_lines: [
          {
            invoiced_quantity: '1.000000',
            line_extension_amount: '100000.00',
            description: 'PRODUCTO CON IVA',
            price_amount: '100000.00',
            tax_totals: [
              {
                tax_id: 1,
                tax_amount: '19000.00',
                taxable_amount: '100000.00',
                percent: '19.00',
              },
            ],
          },
        ],
      }),
      'cufe-123',
    );

    expect(payload.items[0].ivaPercentage).toBe(19);
  });

  it('leaves ivaPercentage undefined when the line has no tax_totals', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult(),
      'cufe-123',
    );

    expect(payload.items[0].ivaPercentage).toBeUndefined();
  });

  it('resta el descuento general del total pero no del IVA (caso reportado: descuento de $50.000)', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        legal_monetary_totals: {
          line_extension_amount: '1000000.00',
          tax_exclusive_amount: '1000000.00',
          tax_inclusive_amount: '1190000.00',
          allowance_total_amount: '50000.00',
          charge_total_amount: '0.00',
          payable_amount: '1140000.00',
        },
      }),
      'cufe-123',
    );

    // El IVA real (190.000) no debe "comerse" el descuento — antes daba 140.000
    // porque se calculaba como payable (ya con el descuento restado) - subtotal.
    expect(payload.totals).toEqual({
      subtotal: 1000000,
      total: 1140000,
      iva: 190000,
      discount: 50000,
    });
  });

  it('no incluye discount en totals cuando no hay descuento general', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        legal_monetary_totals: {
          line_extension_amount: '100000.00',
          tax_exclusive_amount: '100000.00',
          tax_inclusive_amount: '119000.00',
          payable_amount: '119000.00',
        },
      }),
      'cufe-123',
    );

    expect(payload.totals).toEqual({ subtotal: 100000, total: 119000, iva: 19000 });
  });

  it('caso 1: usa tax_totals de factura para el IVA aunque el valor unitario ya lo incluya (no duplica)', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        legal_monetary_totals: {
          tax_exclusive_amount: '13445.38',
          tax_inclusive_amount: '16000.00',
          payable_amount: '16000.00',
        },
        tax_totals: [
          { tax_id: 1, tax_amount: '2554.62', taxable_amount: '13445.38', percent: '19.00' },
        ],
        invoice_lines: [
          {
            invoiced_quantity: '2',
            description: 'PRODUCTO CON IVA INCLUIDO',
            price_amount: '8000.00',
          },
        ],
      }),
      'cufe-123',
    );

    expect(payload.totals).toEqual({
      subtotal: 13445.38,
      total: 16000,
      iva: 2554.62,
    });
  });

  it('caso 2: factura de muestra sin valor comercial — el total sale de payable_amount, no de tax_inclusive_amount', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        legal_monetary_totals: {
          tax_exclusive_amount: '44850.00',
          tax_inclusive_amount: '8521.50',
          payable_amount: '8521.50',
        },
        tax_totals: [
          { tax_id: 1, tax_amount: '8521.50', taxable_amount: '44850.00', percent: '19.00' },
        ],
      }),
      'cufe-123',
    );

    expect(payload.totals).toEqual({
      subtotal: 44850,
      total: 8521.5,
      iva: 8521.5,
    });
  });

  it('caso 3: factura sin IVA — sigue funcionando cuando no hay tax_totals de factura', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        legal_monetary_totals: {
          tax_exclusive_amount: '0.00',
          tax_inclusive_amount: '16000.00',
          payable_amount: '16000.00',
        },
        invoice_lines: [
          {
            invoiced_quantity: '1',
            line_extension_amount: '16000.00',
            description: 'Recarga celular',
            price_amount: '16000.00',
          },
        ],
      }),
      'cufe-123',
    );

    expect(payload.totals).toEqual({ subtotal: 16000, total: 16000, iva: 0 });
  });

  it('mapea with_holding_tax_totals a payload.withholdings (retención sugerida por el vendedor, certificada en la factura)', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        with_holding_tax_totals: [
          { tax_code: '06', tax_name: 'ReteRenta', tax_amount: '1023.00', percent: '2.50' },
          { tax_code: '05', tax_name: 'ReteIVA', tax_amount: '6144.60', percent: '15.00' },
        ],
      }),
      'cufe-123',
    );

    expect(payload.withholdings).toEqual([
      { dianTaxCode: '06', percentage: 2.5 },
      { dianTaxCode: '05', percentage: 15 },
    ]);
  });

  it('no incluye withholdings cuando la factura no trae with_holding_tax_totals', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult(),
      'cufe-123',
    );

    expect(payload.withholdings).toBeUndefined();
  });

  it('descarta entradas de with_holding_tax_totals sin código o con porcentaje 0 (nunca adivina)', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        with_holding_tax_totals: [
          { tax_code: '', tax_name: 'Desconocido', percent: '2.50' },
          { tax_code: '06', tax_name: 'ReteRenta', percent: '0' },
        ],
      }),
      'cufe-123',
    );

    expect(payload.withholdings).toBeUndefined();
  });

  it('descarta payment_due_date="0001-01-01" (placeholder de NextPyme para facturas sin vencimiento real, ej. Contado) — antes producía un Plazo de -45744 días en el frontend', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        payment_form: {
          payment_form_id: '1',
          payment_method_id: '1',
          payment_due_date: '0001-01-01',
        },
      }),
      'cufe-123',
    );

    expect(payload.invoice.dueDate).toBeUndefined();
  });

  it('conserva un payment_due_date real', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        payment_form: {
          payment_form_id: '2',
          payment_method_id: '1',
          payment_due_date: '2026-04-29',
        },
      }),
      'cufe-123',
    );

    expect(payload.invoice.dueDate).toBe('2026-04-29');
  });

  it('returns a zero total when the monetary fields are missing/garbled', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      buildResult({
        legal_monetary_totals: {
          line_extension_amount: 'not-a-number',
          payable_amount: undefined,
        },
      }),
      'cufe-123',
    );

    expect(payload.totals.total).toBe(0);
  });
});
