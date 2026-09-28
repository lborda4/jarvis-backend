import { extractNextPymeInvoiceXml } from './nextpyme-invoice-xml.helper';
import { DOWNLOAD_XML } from '../../../electronic-document/mappers/invoice-xml-download.fixture';
import { mapInvoiceXmlToPurchaseInvoiceDownload } from '../../../electronic-document/mappers/invoice-xml-to-purchase-invoice-download.mapper';

function response(xmlBytes: unknown, code: unknown = '100') {
  return {
    success: true,
    message: 'Consulta generada con exito',
    ResponseDian: {
      Envelope: {
        Body: {
          GetXmlByDocumentKeyResponse: {
            GetXmlByDocumentKeyResult: {
              Code: code,
              Message: 'Accion completada OK',
              XmlBytesBase64: xmlBytes,
            },
          },
        },
      },
    },
  };
}

describe('NextPyme XML response decoding', () => {
  it('decodes the actual DIAN JSON shape and fills the PDF data including the original QR', () => {
    const xml = extractNextPymeInvoiceXml(
      response(Buffer.from(DOWNLOAD_XML, 'utf8').toString('base64')),
    );
    expect(xml).toBe(DOWNLOAD_XML);
    const dto = mapInvoiceXmlToPurchaseInvoiceDownload(xml, 'doc', 'cufe-123');
    expect(dto).toMatchObject({
      invoiceNumber: 'XML1',
      subtotal: 200,
      iva: 38,
      total: 238,
    });
    expect(dto.items[0]).toMatchObject({
      description: 'Producto original',
      code: '00012',
    });
    expect(dto.dianQrText).toContain('documentkey=cufe-123&test=1');
  });
  it('handles Base64 with line breaks, UTF-8 accents and SOAP scalar wrappers', () => {
    const original =
      '<Invoice><Note>Cr\u00e9dito y retenci\u00f3n</Note></Invoice>';
    const encoded = Buffer.from(original)
      .toString('base64')
      .match(/.{1,20}/g)!
      .join('\n');
    expect(
      extractNextPymeInvoiceXml(
        response({ _value: encoded }, { _value: '100' }),
      ),
    ).toBe(original);
  });
  it.each([
    '',
    null,
    undefined,
    'invalid base64!',
    Buffer.from('not XML').toString('base64'),
  ])('rejects missing or invalid XmlBytesBase64: %s', (value) => {
    expect(() => extractNextPymeInvoiceXml(response(value))).toThrow('XML');
  });
  it('rejects a DIAN error code even when HTTP succeeds', () => {
    expect(() =>
      extractNextPymeInvoiceXml(
        response(Buffer.from('<Invoice/>').toString('base64'), '404'),
      ),
    ).toThrow('codigo 404');
  });
  it.each([
    '<Invoice/>',
    { xml: '<Invoice/>' },
    { data: { xml: Buffer.from('<Invoice/>').toString('base64') } },
  ])('keeps support for existing response formats', (value) => {
    expect(extractNextPymeInvoiceXml(value)).toBe('<Invoice/>');
  });
});
