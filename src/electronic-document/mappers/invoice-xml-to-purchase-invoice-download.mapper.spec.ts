import { mapInvoiceXmlToPurchaseInvoiceDownload as map } from './invoice-xml-to-purchase-invoice-download.mapper';
import { DOWNLOAD_XML } from './invoice-xml-download.fixture';

describe('original UBL to PDF data', () => {
  it('extracts the additional fields of the JARVIS HTML template from XML', () => {
    const xml = DOWNLOAD_XML.replace('<cbc:ID>XML1</cbc:ID>', '<cbc:CustomizationID>10</cbc:CustomizationID><cac:OrderReference><cbc:ID>OC-TEST</cbc:ID><cbc:IssueDate>2026-08-15</cbc:IssueDate></cac:OrderReference><cac:ReceiptDocumentReference><cbc:ID>GUIA-TEST</cbc:ID><cbc:IssueDate>2026-08-20</cbc:IssueDate></cac:ReceiptDocumentReference><cbc:ID>XML1</cbc:ID>')
      .replace('<sts:InvoiceControl>', '<sts:SoftwareProvider><sts:ProviderID>000999</sts:ProviderID></sts:SoftwareProvider><sts:InvoiceControl><sts:InvoiceAuthorization>AUTH-TEST</sts:InvoiceAuthorization><sts:AuthorizationPeriod><cbc:EndDate>2027-01-01</cbc:EndDate></sts:AuthorizationPeriod>')
      .replace('<cac:AccountingSupplierParty>', '<cac:AccountingSupplierParty><cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>')
      .replace('<cbc:RegistrationName>Proveedor XML</cbc:RegistrationName>', '<cbc:RegistrationName>Proveedor XML</cbc:RegistrationName><cbc:TaxLevelCode>R-99-PN</cbc:TaxLevelCode><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>')
      .replace('<cbc:AllowanceTotalAmount>0</cbc:AllowanceTotalAmount>', '<cbc:AllowanceTotalAmount>0</cbc:AllowanceTotalAmount><cbc:PrepaidAmount>25</cbc:PrepaidAmount><cbc:TaxInclusiveAmount>263</cbc:TaxInclusiveAmount>');
    const dto = map(xml, 'doc', 'cufe-123');
    expect(dto).toMatchObject({ operationType: '10', orderNumber: 'OC-TEST', orderDate: '2026-08-15', technologyProviderId: '000999', prepaidAmount: 25, taxInclusiveAmount: 263, authorization: { number: 'AUTH-TEST', endDate: '2027-01-01' } });
    expect(dto.references).toEqual([{ type: 'Aviso de Recibo', number: 'GUIA-TEST', date: '2026-08-20' }]);
    expect(dto.issuer).toMatchObject({ contributorType: 'Persona Juridica', fiscalRegime: 'R-99-PN', taxResponsibility: '01 - IVA' });
    expect(dto.items[0].unitCode).toBe('EA');
  });

  it('preserves XML identity, original QR, exact taxes and identifiers with leading zeros', () => {
    const dto = map(DOWNLOAD_XML, 'doc', 'cufe-123');
    expect(dto).toMatchObject({
      id: 'doc',
      invoiceNumber: 'XML1',
      prefix: 'XML',
      total: 238,
      subtotal: 200,
      iva: 38,
      isCreditPayment: true,
      dueDate: '2026-10-01',
      observations: 'Primera nota\nSegunda nota',
    });
    expect(dto.issuer).toMatchObject({
      name: 'Proveedor XML',
      documentNumber: '001234567',
      checkDigit: '5',
      documentType: 'NIT',
      address: 'Calle 1',
    });
    expect(dto.buyer.name).toBe('Comprador XML');
    expect(dto.items[0]).toMatchObject({
      code: '00012',
      quantity: 2,
      unitValue: 210,
      total: 200,
      discount: 10,
      ivaAmount: 38,
      ivaPercentage: 19,
    });
    expect(dto.withholdings[0]).toMatchObject({
      dianTaxCode: '06',
      amount: 5,
      percentage: 2.5,
    });
    expect(dto.items[0].withholdings).toEqual([
      { dianTaxCode: '06', name: 'ReteFuente', percentage: 2.5, amount: null },
    ]);
    expect(dto.dianQrText).toBe(
      'CUFE: cufe-123\nhttps://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=cufe-123&test=1',
    );
  });
  it('reads a signed Invoice embedded in AttachedDocument', () => {
    const wrapped = `<AttachedDocument><Attachment><ExternalReference><Description><![CDATA[${DOWNLOAD_XML}]]></Description></ExternalReference></Attachment></AttachedDocument>`;
    expect(map(wrapped, 'doc', 'cufe-123').total).toBe(238);
  });
  it('builds a QR with the actual issue time only when no original QR exists', () => {
    const xml = DOWNLOAD_XML.replace(/<sts:QRCode>[\s\S]*?<\/sts:QRCode>/, '');
    expect(map(xml, 'doc', 'cufe-123').dianQrText).toContain(
      'HorFac: 09:12:00-05:00',
    );
  });
  it.each([
    [
      'another CUFE',
      DOWNLOAD_XML.replace('>cufe-123</cbc:UUID>', '>other</cbc:UUID>'),
    ],
    ['invalid XML', '<Invoice>'],
    ['no invoice', '<ApplicationResponse/>'],
    [
      'missing total',
      DOWNLOAD_XML.replace(
        /<cbc:PayableAmount[^>]*>.*?<\/cbc:PayableAmount>/,
        '',
      ),
    ],
    [
      'invalid number',
      DOWNLOAD_XML.replace(
        '>238</cbc:PayableAmount>',
        '>NaN</cbc:PayableAmount>',
      ),
    ],
    ['DTD', '<!DOCTYPE Invoice><Invoice/>'],
  ])('rejects %s instead of generating a misleading PDF', (_label, xml) => {
    expect(() => map(xml, 'doc', 'cufe-123')).toThrow();
  });
});
