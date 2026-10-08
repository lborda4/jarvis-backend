import { JarvisInvoicePdfService } from './jarvis-invoice-pdf.service';
import { DOWNLOAD_XML } from '../../electronic-document/mappers/invoice-xml-download.fixture';
describe('sales invoice PDF data', () => {
  function setup(invoice: unknown) {
    const query = { addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(invoice) };
    const repository = { createQueryBuilder: jest.fn(() => query), update: jest.fn() };
    const companies = { findById: jest.fn().mockResolvedValue({ nextPymeToken: 'company-token' }) };
    const client = { getInvoiceXmlByCufe: jest.fn().mockResolvedValue(DOWNLOAD_XML) };
    const logos = { get: jest.fn().mockResolvedValue({ logoDataUrl: null }) };
    return { service: new JarvisInvoicePdfService(repository as never, companies as never, client as never, logos as never), repository, query, client, logos };
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
});
