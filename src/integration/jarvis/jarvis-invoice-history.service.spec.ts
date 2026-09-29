import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import { JarvisInvoiceHistoryService } from './jarvis-invoice-history.service';
function setup() {
  const query: any = {};
  for (const name of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'skip', 'take']) query[name] = jest.fn().mockReturnValue(query);
  query.getManyAndCount = jest.fn().mockResolvedValue([[{ id: 'invoice-1', companyId: 'company-1', total: '100.00' }], 21]);
  const repository = { createQueryBuilder: jest.fn().mockReturnValue(query), upsert: jest.fn() };
  return { service: new JarvisInvoiceHistoryService(repository as never), query, repository };
}
describe('Historial de facturas de venta', () => {
  it('aisla por empresa y pagina sin mezclar resultados', async () => {
    const { service, query } = setup();
    const result = await service.list('company-1', { page: '2', search: "Cliente'", from: '2026-09-01', to: '2026-09-30' });
    expect(query.where).toHaveBeenCalledWith('invoice.companyId = :companyId', { companyId: 'company-1' });
    expect(query.skip).toHaveBeenCalledWith(20);
    expect(query.take).toHaveBeenCalledWith(20);
    expect(query.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :search'), { search: "%Cliente'%" });
    expect(result).toMatchObject({ total: 21, page: 2, pageSize: 20 });
    expect(result.items[0]).toMatchObject({ status: 'SENT' });
    expect(result.items[0]).not.toHaveProperty('companyId');
  });
  it.each([{ page: '0' }, { page: 'abc' }, { from: '2026-02-30' }, { from: '2026-10-01', to: '2026-09-01' }])('rechaza filtros invalidos %j', async (filters) => {
    const { service, repository } = setup();
    await expect(service.list('company-1', filters)).rejects.toThrow();
    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
  });
  it('no consulta sin empresa activa', async () => {
    await expect(setup().service.list('')).rejects.toThrow();
  });
  it('usa la empresa y numeracion como clave para evitar duplicados', async () => {
    const { service, repository } = setup();
    const invoice = { companyId: 'company-1', prefix: 'FV', number: '1', providerId: 'remote-1', issueDate: '2026-09-29', customerName: 'Cliente', customerIdentification: '123', currency: 'COP', total: '100.00', cufe: null };
    await service.record(invoice);
    expect(repository.upsert).toHaveBeenCalledWith({ ...invoice, documentKind: 'ELECTRONIC_INVOICE' }, ['companyId', 'documentKind', 'prefix', 'number']);
  });
});

describe('Historial separado por tipo de documento', () => {
  it('las ventas solo consultan facturas de venta', async () => {
    const { service, query } = setup();
    await service.list('company-1');
    expect(query.andWhere).toHaveBeenCalledWith('invoice.documentKind = :documentKind', { documentKind: 'ELECTRONIC_INVOICE' });
  });
  it('los soportes consultan solamente su tipo de documento', async () => {
    const { service, query } = setup();
    await service.list('company-1', {}, JarvisResolutionKind.SUPPORT_DOCUMENT);
    expect(query.andWhere).toHaveBeenCalledWith('invoice.documentKind = :documentKind', { documentKind: 'SUPPORT_DOCUMENT' });
  });
});
