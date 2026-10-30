import {
  emptyCufeImportRow,
  normalizePurchaseInvoiceCufe,
  resolveCufeImportRow,
} from './purchase-invoice-cufe.helper';
import { mapNextPymeInvoiceQueryToElectronicDocumentPayload } from '../../electronic-document/mappers/nextpyme-invoice-query-to-payload.mapper';
const cufe = 'a'.repeat(96);
const data = {
  type_document_id: 1,
  prefix: 'FC',
  number: '10',
  date: '2026-10-29',
  seller: { identification_number: '900123456', name: 'Proveedor' },
  customer: { identification_number: '800123456-1', name: 'Empresa' },
  legal_monetary_totals: {
    line_extension_amount: 100000,
    payable_amount: 108000,
  },
  tax_totals: [
    { tax_code: '04', tax_name: 'INC', percent: 8, tax_amount: 8000 },
  ],
  invoice_lines: [
    {
      description: 'Compra',
      invoiced_quantity: 1,
      price_amount: 100000,
      line_extension_amount: 100000,
      tax_totals: [{ tax_code: '04', percent: 8, tax_amount: 8000 }],
    },
  ],
};
describe('Importación por CUFE', () => {
  it('normaliza el CUFE antes de crear el trabajo', () =>
    expect(normalizePurchaseInvoiceCufe(' ' + cufe.toUpperCase() + ' ')).toBe(
      cufe,
    ));
  it.each([null, '', 'a'.repeat(95), 'z'.repeat(96), ['a']])(
    'rechaza CUFE inválido %s',
    (value) =>
      expect(() => normalizePurchaseInvoiceCufe(value)).toThrow('CUFE válido'),
  );
  it('completa la fila con la misma respuesta NextPyme que procesa el Excel', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      data,
      cufe,
    );
    expect(resolveCufeImportRow(data, payload, '800.123.456-1')).toEqual(
      expect.objectContaining({
        importSource: 'CUFE',
        cufe,
        issuerNit: '900123456',
        issuerName: 'Proveedor',
        total: 108000,
        iva: 0,
        group: 'Recibido',
      }),
    );
    expect(payload.taxes).toEqual([{ type: 'INC', amount: 8000 }]);
  });
  it.each(['another-company', undefined])(
    'rechaza una factura de otra empresa o sin empresa',
    (nit) => {
      expect(() =>
        resolveCufeImportRow(
          data,
          mapNextPymeInvoiceQueryToElectronicDocumentPayload(data, cufe),
          nit,
        ),
      ).toThrow('empresa activa');
    },
  );
  it('rechaza una nota crédito aunque su receptor coincida', () => {
    expect(() =>
      resolveCufeImportRow(
        { ...data, type_document_id: 4 },
        mapNextPymeInvoiceQueryToElectronicDocumentPayload(data, cufe),
        '800123456',
      ),
    ).toThrow('compra válida');
  });
  it('no usa una fila vacía como respaldo si faltan montos', () => {
    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      data,
      cufe,
    );
    payload.totals.total = 0;
    expect(() => resolveCufeImportRow(data, payload, '800123456')).toThrow(
      'datos completos',
    );
    expect(emptyCufeImportRow(cufe).importSource).toBe('CUFE');
  });
});
