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

describe('listado unificado', () => {
  it('pagina y filtra guardados y enviados juntos dentro de la empresa', async () => {
    const items = [{ id: 'saved', status: 'SAVED' }, { id: 'sent', status: 'SENT' }];
    const query = jest.fn().mockResolvedValueOnce([{ total: '23' }]).mockResolvedValueOnce(items);
    const service = new JarvisInvoiceHistoryService({ query } as never);
    const result = await service.list(' company ', { search: 'Cliente', from: '2026-10-01', to: '2026-10-16', page: '2' });
    expect(result).toEqual({ items, total: 23, page: 2, pageSize: 20 });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('jarvis_invoice_drafts WHERE company_id=$1 AND document_kind=$2');
    expect(sql).toContain('jarvis_sales_invoices WHERE company_id=$1 AND document_kind=$2');
    expect(params).toEqual(['company', JarvisResolutionKind.ELECTRONIC_INVOICE, '%Cliente%', '2026-10-01', '2026-10-16', 20, 20]);
    expect(sql).not.toContain('Cliente');
    expect(sql).toContain('ORDER BY "sentAt" DESC,id DESC');
  });
  it('no consulta la base con una pagina invalida', async () => {
    const query = jest.fn();
    const service = new JarvisInvoiceHistoryService({ query } as never);
    await expect(service.list('company', { page: '0' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});