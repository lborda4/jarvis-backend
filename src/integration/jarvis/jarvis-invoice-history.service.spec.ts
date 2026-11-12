import { NotFoundException } from '@nestjs/common';
import { JarvisInvoiceHistoryService } from './jarvis-invoice-history.service';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
describe('invoice detail', () => {
  function setup(result: unknown) {
    const query = { addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(result) };
    const repository = { createQueryBuilder: jest.fn(() => query), upsert: jest.fn() };
    return { service: new JarvisInvoiceHistoryService(repository as never), query, repository };
  }
  it('no incluye los bytes del archivo en la consulta normal del detalle', async () => {
    const attachment = { name: 'soporte.pdf', mimeType: 'application/pdf', size: 5, dataBase64: 'JVBERi0=' };
    const { service } = setup({ sourceRequest: { attachment } });
    expect((await service.detail('company', 'invoice')).sourceRequest?.attachment).toEqual({ name: attachment.name, mimeType: attachment.mimeType, size: 5 });
  });
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
    expect(result).toEqual({ items: items.map(item => ({ ...item, adjustmentStatus: 'NONE' })), total: 23, page: 2, pageSize: 20 });
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


describe('estado de ajustes de facturas', () => {
  const cufe = 'a'.repeat(96);
  const invoice = { id: 'invoice', status: 'SENT', prefix: 'FE', number: '1', cufe };
  function setup(items: unknown[], notes: unknown[]) {
    const query = jest.fn().mockResolvedValueOnce([{ total: String(items.length) }]).mockResolvedValueOnce(items).mockResolvedValueOnce(notes);
    return { service: new JarvisInvoiceHistoryService({ query } as never), query };
  }
  it.each([
    [[], 'NONE'],
    [['CREDIT_NOTE'], 'CREDIT_NOTE'],
    [['DEBIT_NOTE'], 'DEBIT_NOTE'],
    [['CREDIT_NOTE', 'CREDIT_NOTE', 'DEBIT_NOTE'], 'CREDIT_AND_DEBIT'],
  ])('identifica las notas enviadas %j de cada factura', async (kinds, expected) => {
    const notes = (kinds as string[]).map(kind => ({ kind, referenceUuid: cufe.toUpperCase(), referenceNumber: 'FE1' }));
    const { service, query } = setup([invoice, { ...invoice, id: 'other', number: '2', cufe: 'b'.repeat(96) }], notes);
    const result = await service.list(' company ', { search: 'Cliente', from: '2026-11-01' });
    expect(result.items[0].adjustmentStatus).toBe(expected);
    expect(result.items[1].adjustmentStatus).toBe('NONE');
    const [sql, parameters] = query.mock.calls[2];
    expect(sql).toContain('FROM jarvis_sales_invoices');
    expect(sql).toContain('company_id=$1');
    expect(sql).toContain("document_kind IN ('CREDIT_NOTE','DEBIT_NOTE')");
    expect(sql).not.toContain('jarvis_invoice_drafts');
    expect(parameters).toEqual(['company', [cufe, 'b'.repeat(96)], []]);
  });
  it('no vincula una nota por numero si su CUFE corresponde a otra factura', async () => {
    const { service } = setup([invoice], [{ kind: 'CREDIT_NOTE', referenceUuid: 'b'.repeat(96), referenceNumber: 'FE1' }]);
    expect((await service.list('company')).items[0].adjustmentStatus).toBe('NONE');
  });
  it('usa el numero completo cuando una factura antigua no tiene CUFE local', async () => {
    const { service, query } = setup([{ ...invoice, number: 'FE1', cufe: null }], [{ kind: 'DEBIT_NOTE', referenceUuid: cufe, referenceNumber: ' FE1 ' }]);
    expect((await service.list('company')).items[0].adjustmentStatus).toBe('DEBIT_NOTE');
    expect(query.mock.calls[2][1]).toEqual(['company', [], ['FE1']]);
  });
  it('no busca ajustes para borradores ni para listados de notas', async () => {
    const drafts = setup([{ ...invoice, status: 'SAVED' }], []);
    expect((await drafts.service.list('company')).items[0].adjustmentStatus).toBe('NONE');
    expect(drafts.query).toHaveBeenCalledTimes(2);
    const notes = setup([invoice], []);
    const result = await notes.service.list('company', {}, JarvisResolutionKind.CREDIT_NOTE);
    expect(result.items[0]).not.toHaveProperty('adjustmentStatus');
    expect(notes.query).toHaveBeenCalledTimes(2);
  });
});


describe('búsqueda de referencia por consecutivo para notas', () => {
  it.each(['F', 'FV', 'FV12', "FV%_'"])('busca %s solo en facturas emitidas y parametriza el texto literal', async number => {
    const query = jest.fn().mockResolvedValueOnce([{ total: '0' }]).mockResolvedValueOnce([]);
    const service = new JarvisInvoiceHistoryService({ query } as never);
    await expect(service.list('owner', { number })).resolves.toMatchObject({ items: [], total: 0 });
    for (const [sql, params] of query.mock.calls) {
      expect(params.slice(0, 3)).toEqual(['owner', JarvisResolutionKind.ELECTRONIC_INVOICE, number]);
      expect(sql).toContain("status='SENT'");
      expect(sql).toContain("NULLIF(BTRIM(cufe),'') IS NOT NULL");
      expect(sql).toContain('POSITION(LOWER($3) IN LOWER(');
      expect(sql).not.toContain('"customerName" ILIKE');
      if (number.length > 2) expect(sql).not.toContain(number);
    }
  });
  it('rechaza consecutivos demasiado largos antes de consultar la base de datos', async () => {
    const query = jest.fn();
    const service = new JarvisInvoiceHistoryService({ query } as never);
    await expect(service.list('owner', { number: 'F'.repeat(101) })).rejects.toThrow('consecutivo');
    expect(query).not.toHaveBeenCalled();
  });
});
