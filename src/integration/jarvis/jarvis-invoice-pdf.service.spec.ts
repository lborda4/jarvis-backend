import { JarvisInvoicePdfService } from './jarvis-invoice-pdf.service';
import { DOWNLOAD_XML } from '../../electronic-document/mappers/invoice-xml-download.fixture';

jest.mock('./pdf/sales-invoice-pdf.renderer', () => ({
  renderJarvisInvoicePdfBase64: jest.fn().mockResolvedValue('JVBERi0x'),
}));
describe('sales invoice PDF data', () => {
  function setup(invoice: unknown) {
    const query = { addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(invoice) };
    const repository = { createQueryBuilder: jest.fn(() => query), update: jest.fn() };
    const companies = { findById: jest.fn().mockResolvedValue({ nextPymeToken: 'company-token', nit: '900123456', name: 'Empresa SAS' }) };
    const client = { getInvoiceXmlByCufe: jest.fn().mockResolvedValue(DOWNLOAD_XML) };
    const logos = { get: jest.fn().mockResolvedValue({ logoDataUrl: null }) };
    const integrations = { findByCompanyAndProvider: jest.fn().mockResolvedValue({ credentials: { business_name: 'Empresa SAS' } }) };
    return { service: new JarvisInvoicePdfService(repository as never, companies as never, client as never, logos as never, integrations as never), repository, query, client, logos, integrations };
  }
  it('adds only the owning company logo to the PDF', async () => {
    const { service, logos } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, documentKind: 'ELECTRONIC_INVOICE' });
    logos.get.mockResolvedValue({ logoDataUrl: 'data:image/png;base64,test' } as never);
    expect((await service.getData('owner', 'id')).logoDataUrl).toBe('data:image/png;base64,test');
    expect(logos.get).toHaveBeenCalledWith('owner', 'JARVIS');
  });
  it('uses the stored signed XML without calling the provider', async () => {
    const { service, client, query } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, documentKind: 'SUPPORT_DOCUMENT' });
    const data = await service.getData('company', 'id');
    expect(data.invoiceNumber).toBe('XML1');
    expect(data.documentKind).toBe('SUPPORT_DOCUMENT');
    expect(data.total).toBe(238);
    expect(data.dianQrText).toContain('documentkey=cufe-123&test=1');
    expect(client.getInvoiceXmlByCufe).not.toHaveBeenCalled();
    expect(query.where).toHaveBeenCalledWith('invoice.companyId = :companyId', { companyId: 'company' });
  });
  it('retrieves and caches old invoice XML using the owning company token', async () => {
    const { service, client, repository } = setup({ cufe: 'cufe-123', invoiceXml: null });
    await service.getData('company', 'id');
    expect(client.getInvoiceXmlByCufe).toHaveBeenCalledWith('cufe-123', 'company-token');
    expect(repository.update).toHaveBeenCalledWith({ id: 'id', companyId: 'company' }, { invoiceXml: DOWNLOAD_XML });
  });
  it('rejects foreign or missing invoices before contacting the provider', async () => {
    const { service, client } = setup(null);
    await expect(service.getData('company', 'other')).rejects.toThrow();
    expect(client.getInvoiceXmlByCufe).not.toHaveBeenCalled();
  });
  it('rejects a different CUFE without caching it', async () => {
    const { service, repository } = setup({ cufe: 'other', invoiceXml: null });
    await expect(service.getData('company', 'id')).rejects.toThrow('CUFE');
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('arma el PDF con los datos emitidos si NextPyme responde 402 al XML', async () => {
    const { service, client, repository, integrations } = setup({
      id: 'note-1',
      cufe: 'cuds-ajuste',
      invoiceXml: null,
      documentKind: 'SUPPORT_CREDIT_NOTE',
      prefix: 'NDS',
      number: '1',
      issueDate: '2026-10-09',
      customerName: 'Proveedor',
      customerIdentification: '111111111',
      currency: 'COP',
      total: '238000.00',
      sourceRequest: {
        issueDate: '2026-10-09',
        customerDocumentType: 'NIT',
        customerIdentification: '111111111',
        billingReference: { number: 'DSJ3', uuid: 'cuds-ds', issueDate: '2026-10-09' },
        items: [{ description: 'Anulación', quantity: 1, unitValue: 200000, taxAmount: 38000, code: 'SERV' }],
      },
    });
    client.getInvoiceXmlByCufe.mockRejectedValue(
      new Error('NextPyme no permitio descargar el XML (HTTP 402). Intenta de nuevo o revisa la integracion de la empresa.'),
    );

    const data = await service.getData('company', 'note-1');

    expect(data.invoiceNumber).toBe('NDS1');
    expect(data.documentKind).toBe('SUPPORT_CREDIT_NOTE');
    expect(data.dianQrText).toContain('cuds-ajuste');
    expect(data.references?.[0]?.number).toBe('DSJ3');
    expect(data.issuer.documentNumber).toBe('900123456');
    expect(data.total).toBe(238000);
    expect(data.subtotal).toBe(200000);
    expect(data.iva).toBe(38000);
    expect(repository.update).not.toHaveBeenCalled();
    expect(integrations.findByCompanyAndProvider).toHaveBeenCalled();
  });

  it('preserves the XML error when an old document has no stored items', async () => {
    const { service, client, integrations } = setup({ cufe: 'cuds', sourceRequest: null });
    client.getInvoiceXmlByCufe.mockRejectedValue(new Error('XML HTTP 402'));
    await expect(service.getData('company', 'id')).rejects.toThrow('XML HTTP 402');
    expect(integrations.findByCompanyAndProvider).not.toHaveBeenCalled();
  });

  it('renders the Jarvis PDF from the issued XML for the email graphic', async () => {
    const { service } = setup({
      cufe: 'cufe-123',
      invoiceXml: DOWNLOAD_XML,
      documentKind: 'ELECTRONIC_INVOICE',
    });
    await expect(
      service.renderGraphicBase64({
        companyId: 'company',
        invoiceXml: DOWNLOAD_XML,
        cufe: 'cufe-123',
        documentKind: 'ELECTRONIC_INVOICE',
      }),
    ).resolves.toBe('JVBERi0x');
  });
});

describe('reenvío de correo de documentos emitidos', () => {
  function setup() {
    const repository = { findOne: jest.fn().mockResolvedValue({ prefix: 'NDS', number: 'NDS5' }) };
    const companies = { findById: jest.fn().mockResolvedValue({ nextPymeToken: 'owner-token' }) };
    const client = { sendDocumentEmail: jest.fn().mockResolvedValue({ success: true }) };
    const service = new JarvisInvoicePdfService(repository as never, companies as never, client as never, {} as never, {} as never);
    jest.spyOn(service, 'getData').mockResolvedValue({ buyer: { email: 'cliente@correo.com' } } as never);
    return { service, repository, client };
  }
  it('envía PDF, correo registrado, copias únicas y mensaje escapado usando el token de la empresa', async () => {
    const { service, repository, client } = setup();
    await expect(service.sendEmail('owner', 'id', { additionalEmails: ['CLIENTE@CORREO.COM', 'copia@correo.com', 'copia@correo.com'], message: '<script>alert(1)</script>' })).resolves.toEqual({ success: true });
    expect(repository.findOne).toHaveBeenCalledWith({ where: { companyId: 'owner', id: 'id' } });
    expect(client.sendDocumentEmail).toHaveBeenCalledWith({
      prefix: 'NDS', number: '5', alternate_email: 'cliente@correo.com',
      email_cc_list: [{ email: 'copia@correo.com' }], send_email_cc_list_as_email_cc: true,
      base64graphicrepresentation: 'JVBERi0x', showacceptrejectbuttons: true,
      html_buttons: '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    }, 'owner-token');
  });
  it('rechaza documentos ajenos antes de contactar al proveedor', async () => {
    const { service, repository, client } = setup();
    repository.findOne.mockResolvedValue(null as never);
    await expect(service.sendEmail('owner', 'foreign-id', {})).rejects.toThrow('No se encontró');
    expect(client.sendDocumentEmail).not.toHaveBeenCalled();
  });
  it('no envía correos con entradas inválidas', async () => {
    const { service, client } = setup();
    await expect(service.sendEmail('owner', 'id', { additionalEmails: ['no-es-correo'] })).rejects.toThrow();
    await expect(service.sendEmail('owner', 'id', { message: 'a'.repeat(501) })).rejects.toThrow();
    expect(client.sendDocumentEmail).not.toHaveBeenCalled();
  });
  it('permite enviar a un correo adicional si no hay correo registrado', async () => {
    const { service, client } = setup();
    jest.mocked(service.getData).mockResolvedValue({ buyer: { email: null } } as never);
    await service.sendEmail('owner', 'id', { additionalEmails: ['nuevo@correo.com'] });
    expect(client.sendDocumentEmail).toHaveBeenCalledWith(expect.objectContaining({ alternate_email: 'nuevo@correo.com', showacceptrejectbuttons: false }), 'owner-token');
  });
  it('no confirma éxito si falla el proveedor', async () => {
    const { service, client } = setup();
    client.sendDocumentEmail.mockRejectedValue(new Error('Proveedor no disponible'));
    await expect(service.sendEmail('owner', 'id', {})).rejects.toThrow('Proveedor no disponible');
    client.sendDocumentEmail.mockResolvedValue({ success: false });
    await expect(service.sendEmail('owner', 'id', {})).rejects.toThrow('no confirmó');
  });
});
