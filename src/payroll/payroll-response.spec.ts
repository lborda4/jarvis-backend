import { payrollCune, payrollFiles } from './payroll-response';
describe('respuestas reales de nómina', () => {
  const cune = 'a'.repeat(96);
  it('extrae CUNE de la respuesta SOAP', () =>
    expect(
      payrollCune({
        ResponseDian: {
          Envelope: { Body: { Result: { XmlDocumentKey: cune } } },
        },
      }),
    ).toBe(cune));
  it('extrae CUNE descrito por DIAN', () =>
    expect(payrollCune({ StatusDescription: `Nómina CUNE ${cune}` })).toBe(
      cune,
    ));
  it('no confunde identificadores internos con CUNE', () =>
    expect(payrollCune({ id: '123' })).toBeNull());
  it('acepta referencias de archivos devueltas sin inventar nombres', () =>
    expect(
      payrollFiles({
        urlinvoicepdf: 'NIS-NE1.pdf',
        urlinvoicexml: 'NIS-NE1.xml',
      }),
    ).toEqual([
      { kind: 'pdf', filename: 'NIS-NE1.pdf' },
      { kind: 'xml', filename: 'NIS-NE1.xml' },
    ]));
  it('rechaza rutas no reconocidas', () =>
    expect(
      payrollFiles({ pdf: '../../secret', xml: 'data:text/html,abc' }),
    ).toEqual([]));
});
