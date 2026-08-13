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
