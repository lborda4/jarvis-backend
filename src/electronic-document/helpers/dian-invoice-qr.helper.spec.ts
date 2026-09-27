import {
  buildDianCatalogQrUrl,
  buildDianInvoiceQrText,
} from './dian-invoice-qr.helper';

describe('buildDianCatalogQrUrl', () => {
  it('arma la URL del catálogo DIAN con el CUFE escapado', () => {
    expect(buildDianCatalogQrUrl('cufe/abc')).toBe(
      'https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=cufe%2Fabc',
    );
  });
});

describe('buildDianInvoiceQrText', () => {
  const base = {
    invoiceNumber: 'SETP990000001',
    issueDate: '2026-07-21',
    issuerNit: '902086460',
    buyerNit: '900123456',
    subtotal: 100000,
    iva: 19000,
    total: 119000,
    cufe: 'cufe-123',
  };

  it('arma el bloque Anexo UBL 2.1 sin HorFac cuando no hay hora', () => {
    const text = buildDianInvoiceQrText(base);

    expect(text).toBe(
      [
        'NumFac: SETP990000001',
        'FecFac: 2026-07-21',
        'NitFac: 902086460',
        'DocAdq: 900123456',
        'ValFac: 100000.00',
        'ValIva: 19000.00',
        'ValTolFac: 119000.00',
        'CUFE: cufe-123',
        'https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=cufe-123',
      ].join('\n'),
    );
    expect(text).not.toContain('HorFac');
  });

  it('incluye HorFac solo cuando viene una hora real', () => {
    const text = buildDianInvoiceQrText({ ...base, issueTime: '14:30:00' });

    expect(text).toContain('HorFac: 14:30:00');
  });
});
