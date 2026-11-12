import { JarvisInvoicePdfService } from './jarvis-invoice-pdf.service';
import { DOWNLOAD_XML } from '../../electronic-document/mappers/invoice-xml-download.fixture';

jest.mock('./pdf/sales-invoice-pdf.renderer', () => ({
  renderJarvisInvoicePdfBase64: jest.fn().mockResolvedValue('JVBERi0x'),
}));
describe('sales invoice PDF data', () => {
  it('aplica las preferencias actuales de la empresa al visor y al PDF de correo', async () => {
    const appearance = { accentColor: '#123456', footerText: 'Gracias por tu compra.', showLogo: false };
    const { service, integrations } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, documentKind: 'ELECTRONIC_INVOICE' });
    integrations.findByCompanyAndProvider.mockResolvedValue({ credentials: { business_name: 'Empresa SAS', invoice_appearance: appearance } } as never);
    expect((await service.getData('company', 'id')).invoiceAppearance).toEqual(appearance);
    const renderer = jest.requireMock('./pdf/sales-invoice-pdf.renderer');
    renderer.renderJarvisInvoicePdfBase64.mockClear();
    await service.renderGraphicBase64({ companyId: 'company', historyId: 'id' });
    expect(renderer.renderJarvisInvoicePdfBase64).toHaveBeenCalledWith(expect.objectContaining({ invoiceAppearance: appearance }));
    renderer.renderJarvisInvoicePdfBase64.mockClear();
    await service.renderGraphicBase64({ companyId: 'company', invoiceXml: DOWNLOAD_XML, cufe: 'cufe-123', documentKind: 'ELECTRONIC_INVOICE' });
    expect(renderer.renderJarvisInvoicePdfBase64).toHaveBeenCalledWith(expect.objectContaining({ invoiceAppearance: appearance }));
  });

  it('no aplica las preferencias de la factura a una nota crédito', async () => {
    const { service, integrations } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, documentKind: 'CREDIT_NOTE' });
    integrations.findByCompanyAndProvider.mockResolvedValue({ credentials: { invoice_appearance: { accentColor: '#123456', footerText: 'Solo facturas', showLogo: false } } } as never);
    expect((await service.getData('company', 'id')).invoiceAppearance).toBeUndefined();
  });

  it('completa el perfil ausente con la configuracion local de Jarvis sin consultar NextPyme', async () => {
    const { service, integrations, client } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML });
    integrations.findByCompanyAndProvider.mockResolvedValue({ credentials: {
      business_name: 'Empresa SAS', vat_regime: 'non_vat_responsible', economic_activity: '4923', tax_responsibility: 'R-99-PN',
    } } as never);
    const data = await service.getData('company', 'id');
    expect(data.issuerTaxProfile).toMatchObject({ source: 'current', economicActivity: '4923', vatRegime: 'non_vat_responsible', taxResponsibility: 'R-99-PN' });
    expect(integrations.findByCompanyAndProvider).toHaveBeenCalledWith('company', 'JARVIS');
    expect(client.getInvoiceXmlByCufe).not.toHaveBeenCalled();
    expect(data.total).toBe(238);
    expect(data.iva).toBe(38);
  });

  it('consulta siempre la configuracion de Jarvis aunque la factura tenga un perfil completo', async () => {
    const saved = { source: 'emission', vatRegime: 'vat_responsible', economicActivity: '1410', taxResponsibility: 'O-13', icaRate: 0 };
    const { service, integrations, client } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, sourceRequest: { issuerTaxProfile: saved } });
    integrations.findByCompanyAndProvider.mockResolvedValue({ credentials: {
      vat_regime: 'non_vat_responsible', economic_activity: '4923', tax_responsibility: 'R-99-PN', ica_rate: 4.14,
    } } as never);
    const first = await service.getData('company', 'id');
    expect(first.issuerTaxProfile).toEqual({ source: 'current', vatRegime: 'non_vat_responsible', economicActivity: '4923', taxResponsibility: 'R-99-PN', icaRate: 4.14 });
    integrations.findByCompanyAndProvider.mockResolvedValue({ credentials: {
      vat_regime: 'vat_responsible', economic_activity: '6201', tax_responsibility: 'O-13', ica_rate: 0,
    } } as never);
    const second = await service.getData('company', 'id');
    expect(second.issuerTaxProfile).toEqual({ source: 'current', vatRegime: 'vat_responsible', economicActivity: '6201', taxResponsibility: 'O-13', icaRate: 0 });
    expect(integrations.findByCompanyAndProvider).toHaveBeenCalledTimes(2);
    expect(integrations.findByCompanyAndProvider).toHaveBeenCalledWith('company', 'JARVIS');
    expect(client.getInvoiceXmlByCufe).not.toHaveBeenCalled();
  });

  it('no recupera el perfil historico cuando no existe configuracion de Jarvis', async () => {
    const saved = { source: 'emission', vatRegime: 'vat_responsible', economicActivity: '1410' };
    const { service, integrations } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, sourceRequest: { issuerTaxProfile: saved } });
    integrations.findByCompanyAndProvider.mockResolvedValue(null as never);
    expect((await service.getData('company', 'id')).issuerTaxProfile).toBeUndefined();
  });

  it.each([undefined, '', '   '])('completa el IVA %s junto con los demas datos desde la configuracion de Jarvis', async vatRegime => {
    const saved = { source: 'emission', vatRegime, economicActivity: '1410', taxResponsibility: 'O-13', icaRate: 0 };
    const { service, integrations, client } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, sourceRequest: { issuerTaxProfile: saved } });
    integrations.findByCompanyAndProvider.mockResolvedValue({ credentials: {
      vat_regime: 'non_vat_responsible', economic_activity: '4923', tax_responsibility: 'R-99-PN', ica_rate: 4.14,
    } } as never);
    const data = await service.getData('company', 'id');
    expect(data.issuerTaxProfile).toEqual({ source: 'current', vatRegime: 'non_vat_responsible', economicActivity: '4923', taxResponsibility: 'R-99-PN', icaRate: 4.14 });
    expect(integrations.findByCompanyAndProvider).toHaveBeenCalledWith('company', 'JARVIS');
    expect(client.getInvoiceXmlByCufe).not.toHaveBeenCalled();
  });

  it('informa el adjunto sin cargar sus bytes en la respuesta del visor', async () => {
    const attachment = { name: 'soporte.pdf', mimeType: 'application/pdf', size: 5, dataBase64: 'JVBERi0=' };
    const { service } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, sourceRequest: { attachment } });
    expect((await service.getData('company', 'id')).attachment).toEqual({ name: attachment.name, mimeType: attachment.mimeType, size: 5 });
  });
  it('incluye el desglose guardado aunque el XML tenga una sola forma de pago', async () => {
    const paymentBreakdown = [{ methodId: 'cash', methodName: 'Efectivo', nextpymeMethodId: 10, negotiation: 'CASH', amount: 100 }, { methodId: 'credit', methodName: 'Crédito clientes', nextpymeMethodId: 1, negotiation: 'CREDIT', amount: 138 }];
    const { service } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, documentKind: 'ELECTRONIC_INVOICE', sourceRequest: { paymentBreakdown } });
    expect((await service.getData('company', 'id')).paymentBreakdown).toEqual(paymentBreakdown);
  });
  it('no agrega los vendedores internos al PDF del correo automatico', async () => {
    const { service } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, documentKind: 'ELECTRONIC_INVOICE', sourceRequest: { sellers: [{ id: 'seller-1', name: 'Laura Perez' }] } });
    const renderer = jest.requireMock('./pdf/sales-invoice-pdf.renderer');
    renderer.renderJarvisInvoicePdfBase64.mockClear();
    await service.renderGraphicBase64({ companyId: 'company', historyId: 'id' });
    expect(renderer.renderJarvisInvoicePdfBase64).toHaveBeenCalled();
    expect(renderer.renderJarvisInvoicePdfBase64.mock.calls[0][0]).not.toHaveProperty('sellers');
  });
  it('incluye los vendedores guardados aunque no existan en el XML DIAN', async () => {
    const sellers = [{ id: 'seller-1', name: 'Laura Perez' }, { id: 'seller-2', name: 'Juan Diaz' }];
    const { service } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, documentKind: 'ELECTRONIC_INVOICE', sourceRequest: { sellers } });
    expect((await service.getData('company', 'id')).sellers).toEqual(sellers);
  });
  it('prioriza los datos fiscales del XML y usa solo nombres de producto guardados al emitir', async () => {
    const { service, integrations } = setup({ cufe: 'cufe-123', invoiceXml: DOWNLOAD_XML, sourceRequest: { emissionSnapshot: {
      issuer: { name: 'Nombre local diferente' }, buyer: { name: 'Tercero editado' },
      items: [{ code: '00012', description: 'Producto original', name: 'Nombre al emitir' }],
    } } });
    const data = await service.getData('company', 'id');
    expect(data.issuer.name).toBe('Proveedor XML');
    expect(data.buyer.name).toBe('Comprador XML');
    expect(data.items[0].name).toBe('Nombre al emitir');
    expect(data.items[0].description).toBe('Producto original');
  });

  it.each(['ELECTRONIC_INVOICE', 'SUPPORT_DOCUMENT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT_CREDIT_NOTE'])('conserva partes y productos emitidos en %s si el proveedor no entrega XML', async documentKind => {
    const saved = { issuer: { name: 'Emisor original', documentNumber: '123', address: 'Calle original' },
      buyer: { name: 'Cliente original', documentNumber: '456', email: 'original@example.com' },
      items: [{ code: 'P1', description: 'Descripción enviada', name: 'Producto original' }] };
    const { service, client, companies, integrations } = setup({ id: 'id', cufe: 'issued-code', invoiceXml: null, documentKind, prefix: 'FE', number: '1', issueDate: '2026-11-06', total: '100',
      sourceRequest: { emissionSnapshot: saved, items: [{ code: 'P1', description: 'Descripción enviada', quantity: 1, unitValue: 100 }] } });
    client.getInvoiceXmlByCufe.mockRejectedValue(new Error('XML no disponible'));
    companies.findById.mockResolvedValue({ nextPymeToken: 'new-token', name: 'Empresa nueva', nit: '999' });
    const first = await service.getData('company', 'id');
    integrations.findByCompanyAndProvider.mockResolvedValue({ credentials: { business_name: 'Otra empresa' } });
    const second = await service.getData('company', 'id');
    expect(first.issuer).toMatchObject(saved.issuer);
    expect(first.buyer).toMatchObject(saved.buyer);
    expect(first.items[0]).toMatchObject({ name: 'Producto original', description: 'Descripción enviada', unitValue: 100 });
    expect(second.issuer).toEqual(first.issuer);
    expect(second.buyer).toEqual(first.buyer);
    expect(second.items).toEqual(first.items);
  });

  function setup(invoice: unknown) {
    const query = { addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(invoice) };
    const repository = { createQueryBuilder: jest.fn(() => query), update: jest.fn() };
    const companies = { findById: jest.fn().mockResolvedValue({ nextPymeToken: 'company-token', nit: '900123456', name: 'Empresa SAS' }) };
    const client = { getInvoiceXmlByCufe: jest.fn().mockResolvedValue(DOWNLOAD_XML) };
    const logos = { get: jest.fn().mockResolvedValue({ logoDataUrl: null }) };
    const integrations = { findByCompanyAndProvider: jest.fn().mockResolvedValue({ credentials: { business_name: 'Empresa SAS' } }) };
    return { service: new JarvisInvoicePdfService(repository as never, companies as never, client as never, logos as never, integrations as never), repository, query, client, logos, integrations, companies };
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
    expect(data.issuer.documentNumber).toBeNull();
    expect(data.total).toBe(238000);
    expect(data.subtotal).toBe(200000);
    expect(data.iva).toBe(38000);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('preserves the XML error when an old document has no stored items', async () => {
    const { service, client, integrations } = setup({ cufe: 'cuds', sourceRequest: null });
    client.getInvoiceXmlByCufe.mockRejectedValue(new Error('XML HTTP 402'));
    await expect(service.getData('company', 'id')).rejects.toThrow('XML HTTP 402');
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
  it('incluye las copias guardadas al emitir y evita duplicarlas con las adicionales', async () => {
    const { service, client } = setup();
    const data = await service.getData('owner', 'id');
    jest.mocked(service.getData).mockResolvedValue({ ...data, recipientCopyEmails: ['cc@example.com', 'CLIENTE@CORREO.COM'] });
    await service.sendEmail('owner', 'id', { additionalEmails: ['CC@example.com', 'extra@example.com'] });
    expect(client.sendDocumentEmail).toHaveBeenCalledWith(expect.objectContaining({ alternate_email: 'cliente@correo.com', email_cc_list: [{ email: 'cc@example.com' }, { email: 'extra@example.com' }] }), 'owner-token');
  });
  function setup() {
    const repository = { findOne: jest.fn().mockResolvedValue({ prefix: 'NDS', number: 'NDS5' }) };
    const companies = { findById: jest.fn().mockResolvedValue({ nextPymeToken: 'owner-token' }) };
    const client = { sendDocumentEmail: jest.fn().mockResolvedValue({ success: true }) };
    const service = new JarvisInvoicePdfService(repository as never, companies as never, client as never, {} as never, {} as never);
    jest.spyOn(service, 'getData').mockResolvedValue({ issuer: { name: 'Empresa SAS', documentNumber: '900123456' }, buyer: { email: 'cliente@correo.com', name: 'Cliente' }, invoiceNumber: 'NDS5', issueDate: '2026-10-12', total: 238000, currency: 'COP', documentKind: 'SUPPORT_CREDIT_NOTE' } as never);
    return { service, repository, client };
  }
  it('envía PDF, correo registrado, copias únicas y mensaje escapado usando el token de la empresa', async () => {
    const { service, repository, client } = setup();
    await expect(service.sendEmail('owner', 'id', { additionalEmails: ['CLIENTE@CORREO.COM', 'copia@correo.com', 'copia@correo.com'], message: '<script>alert(1)</script>' })).resolves.toEqual({ success: true });
    expect(repository.findOne).toHaveBeenCalledWith({ where: { companyId: 'owner', id: 'id' } });
    expect(client.sendDocumentEmail).toHaveBeenCalledWith({
      prefix: 'NDS', number: '5', alternate_email: 'cliente@correo.com',
      email_cc_list: [{ email: 'copia@correo.com' }], send_email_cc_list_as_email_cc: true,
      base64graphicrepresentation: 'JVBERi0x', showacceptrejectbuttons: false,
      html_buttons: '',
      html_header: expect.not.stringContaining('JARVIS'),
      html_body: expect.stringContaining('&lt;script&gt;alert(1)&lt;/script&gt;'),
      html_footer: expect.stringContaining('https://jarviscol.com'),
    }, 'owner-token');
    const body = client.sendDocumentEmail.mock.calls[0][0] as unknown as { html_body: string };
    expect(body.html_body).toContain('Empresa SAS');
    expect(body.html_body).toContain('NDS5');
    expect(body.html_body).toContain('Nota de ajuste de documento soporte');
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
    const data = await service.getData('owner', 'id');
    jest.mocked(service.getData).mockResolvedValue({ ...data, buyer: { ...data.buyer, email: null } });
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
