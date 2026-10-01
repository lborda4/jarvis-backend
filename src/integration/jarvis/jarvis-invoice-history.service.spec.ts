import { NotFoundException } from '@nestjs/common';
import { JarvisInvoiceHistoryService } from './jarvis-invoice-history.service';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
describe('invoice detail', () => {
  function setup(result: unknown) {
    const query = { addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(result) };
    const repository = { createQueryBuilder: jest.fn(() => query), upsert: jest.fn() };
    return { service: new JarvisInvoiceHistoryService(repository as never), query, repository };
  }
  it('restricts invoice detail to the authenticated company and sales invoices', async () => {
    const sourceRequest = { items: [{ description: 'Original', unitValue: 100 }] };
    const { service, query } = setup({ id: 'invoice', companyId: 'company', sourceRequest });
    const detail = await service.detail('company', 'invoice');
    expect(query.where).toHaveBeenCalledWith('invoice.companyId = :companyId', { companyId: 'company' });
    expect(query.andWhere).toHaveBeenCalledWith('invoice.id = :id', { id: 'invoice' });
    expect(query.andWhere).toHaveBeenCalledWith('invoice.documentKind = :kind', { kind: JarvisResolutionKind.ELECTRONIC_INVOICE });
    expect(detail.sourceRequest).toEqual(sourceRequest);
    expect(detail).not.toHaveProperty('companyId');
  });
  it('does not expose missing invoices or invoices from another company', async () => {
    await expect(setup(null).service.detail('company', 'other')).rejects.toBeInstanceOf(NotFoundException);
  });
});
