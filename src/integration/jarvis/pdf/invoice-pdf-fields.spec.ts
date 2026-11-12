
import { invoicePdfTaxDetails, pdfOptionalText } from './invoice-pdf-fields'

it.each([null, undefined, '', ' ', '-', ' — ', '–', '---'])('omite valores ausentes y guiones: %s', value => {
  expect(pdfOptionalText(value)).toBeNull()
})

it('conserva los ceros y los textos válidos', () => {
  expect(pdfOptionalText(0)).toBe('0')
  expect(pdfOptionalText(' 0 ')).toBe('0')
  expect(pdfOptionalText(' R-99-PN ')).toBe('R-99-PN')
})

it.each(['CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT_CREDIT_NOTE'])('no muestra rangos internos de una nota %s como resolución DIAN', documentKind => {
  const details = invoicePdfTaxDetails({ documentKind, prefix: 'NC', authorization: { number: '123', from: '1', to: '99999' }, issuerTaxProfile: { taxResponsibility: 'R-99-PN' } })
  expect(details).toMatchObject({ title: 'Información tributaria', lines: ['Responsabilidad fiscal: R-99-PN'] })
})

it('no muestra un encabezado de resolución por tener únicamente el prefijo del documento', () => {
  expect(invoicePdfTaxDetails({ prefix: 'FE' }).lines).toEqual([])
})
