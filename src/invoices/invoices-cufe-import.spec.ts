import { InvoicesService } from './invoices.service';
describe('Crear trabajo de una compra por CUFE', () => {
  function setup() {
    const service = Object.create(InvoicesService.prototype) as InvoicesService;
    const documents = { resolveDocumentProvider: jest.fn(async () => 'SIIGO') };
    const jobs = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ ...data, id: 'job' })),
    };
    const rows = { create: jest.fn((data) => data), saveMany: jest.fn() };
    Object.assign(service, {
      electronicDocumentService: documents,
      purchaseInvoiceImportJobsRepository: jobs,
      purchaseInvoiceImportJobRowsRepository: rows,
    });
    return { service, documents, jobs, rows };
  }
  it('encola exactamente una fila en SIIGO para la empresa autenticada', async () => {
    const { service, documents, jobs, rows } = setup();
    const cufe = 'a'.repeat(96);
    await expect(
      service.importPurchaseInvoiceByCufe(
        ' ' + cufe.toUpperCase() + ' ',
        'company',
      ),
    ).resolves.toEqual({ jobId: 'job', totalRows: 1 });
    expect(documents.resolveDocumentProvider).toHaveBeenCalledWith(
      'company',
      'SIIGO',
    );
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company',
        provider: 'SIIGO',
        totalRows: 1,
        status: 'pending',
      }),
    );
    expect(rows.saveMany).toHaveBeenCalledWith([
      expect.objectContaining({
        jobId: 'job',
        rowIndex: 1,
        cufe,
        rawRow: expect.objectContaining({ importSource: 'CUFE', cufe }),
      }),
    ]);
  });
  it('no crea un trabajo si el CUFE es inválido', async () => {
    const { service, jobs } = setup();
    await expect(
      service.importPurchaseInvoiceByCufe('invalid', 'company'),
    ).rejects.toThrow('CUFE válido');
    expect(jobs.save).not.toHaveBeenCalled();
  });
  it('no encola si la empresa no puede usar la integración SIIGO', async () => {
    const { service, documents, jobs } = setup();
    documents.resolveDocumentProvider.mockRejectedValue(
      new Error('Sin integración'),
    );
    await expect(
      service.importPurchaseInvoiceByCufe('a'.repeat(96), 'company'),
    ).rejects.toThrow('Sin integración');
    expect(jobs.save).not.toHaveBeenCalled();
  });
});
