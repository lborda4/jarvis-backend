import { resolveProviderInvoiceParts } from './electronic-document-to-siigo-purchase.mapper';

describe('resolveProviderInvoiceParts', () => {
  it('usa invoice.prefix directo (no lo re-parsea) y resta ese prefijo de invoice.number para el consecutivo', () => {
    expect(
      resolveProviderInvoiceParts({ number: 'G9C4304200', prefix: 'G9C4' }),
    ).toEqual({ prefix: 'G9C4', number: '304200' });
  });

  it.each([
    ['K330', '62890', 'K33062890'],
    ['66DJ', '28708', '66DJ28708'],
    ['B512', '136490', 'B512136490'],
    ['PE4', '85043', 'PE485043'],
  ])(
    'no falla con prefijos alfanuméricos reales (bug reportado: prefijo="%s" con 4+ caracteres nunca se detectaba)',
    (prefix, consecutive, fullNumber) => {
      expect(
        resolveProviderInvoiceParts({ number: fullNumber, prefix }),
      ).toEqual({ prefix, number: consecutive });
    },
  );

  it('cae a parseProviderInvoiceNumber (regex) cuando no hay invoice.prefix separado', () => {
    expect(resolveProviderInvoiceParts({ number: 'FE12345' })).toEqual({
      prefix: 'FE',
      number: '12345',
    });
  });

  it('si invoice.number no arranca con el prefijo dado, usa el número completo tal cual (no descarta datos)', () => {
    expect(
      resolveProviderInvoiceParts({ number: '12345', prefix: 'FE' }),
    ).toEqual({ prefix: 'FE', number: '12345' });
  });
});
