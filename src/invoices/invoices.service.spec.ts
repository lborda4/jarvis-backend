import { InvoicesService } from './invoices.service';
import { PurchaseInvoiceImportJobStatus } from './enums/purchase-invoice-import-job-status.enum';
import { parseDianSalesInvoiceExcel } from './helpers/sales-invoice-excel.helper';

jest.mock('./helpers/sales-invoice-excel.helper');

const mockedParseDianSalesInvoiceExcel =
  parseDianSalesInvoiceExcel as jest.MockedFunction<
    typeof parseDianSalesInvoiceExcel
  >;

function buildService() {
  const purchaseInvoiceImportJobsRepository = {
    create: jest.fn((data) => ({ id: 'job-1', ...data })),
    save: jest.fn((job) => Promise.resolve(job)),
    patch: jest.fn().mockResolvedValue(undefined),
  };
  const purchaseInvoiceImportJobRowsRepository = {
    create: jest.fn((data) => data),
    saveMany: jest.fn().mockResolvedValue(undefined),
  };
  const worker = { start: jest.fn().mockResolvedValue(undefined) };

  const service = new InvoicesService(
    {} as never,
    {} as never,
    {} as never,
    { resolveDocumentProvider: jest.fn().mockResolvedValue('JARVIS') } as never,
    {} as never,
    {} as never,
    {} as never,
    purchaseInvoiceImportJobsRepository as never,
    purchaseInvoiceImportJobRowsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    worker as never,
  );

  return {
    service,
    purchaseInvoiceImportJobsRepository,
    purchaseInvoiceImportJobRowsRepository,
    worker,
  };
}

describe('InvoicesService.importPurchaseInvoicesFromExcel', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('inicia el trabajo después de guardar las filas de una solicitud válida', async () => {
    const row = { cufe: 'invoice', issuerNit: '900123456', issuerName: 'Proveedor' };
    mockedParseDianSalesInvoiceExcel.mockReturnValue({ processedRows: 1, rows: [row] } as never);
    const { service, worker, purchaseInvoiceImportJobRowsRepository } = buildService();
    const validate = jest.spyOn(require('./helpers/purchase-invoice-import-validation.helper'), 'validatePurchaseInvoiceExcelRows')
      .mockReturnValue({ invalidRows: 0 });
    try {
      await service.importPurchaseInvoicesFromExcel({ originalname: 'facturas.xlsx', buffer: Buffer.from('') } as never, 'company-1');
      expect(worker.start).toHaveBeenCalledWith('job-1');
      expect(purchaseInvoiceImportJobRowsRepository.saveMany.mock.invocationCallOrder[0])
        .toBeLessThan(worker.start.mock.invocationCallOrder[0]);
    } finally {
      validate.mockRestore();
    }
  });

  it('marca el job COMPLETED de inmediato, en la misma request, cuando el Excel no trae ninguna fila para procesar (bug real: quedaba "0 de 0" esperando al worker en segundo plano)', async () => {
    mockedParseDianSalesInvoiceExcel.mockReturnValue({
      processedRows: 5,
      rows: [],
    });

    const {
      service,
      purchaseInvoiceImportJobsRepository,
      purchaseInvoiceImportJobRowsRepository,
    } = buildService();

    const result = await service.importPurchaseInvoicesFromExcel(
      { originalname: 'facturas.xlsx', buffer: Buffer.from('') } as never,
      'company-1',
    );

    expect(result).toEqual({ jobId: 'job-1', totalRows: 0 });
    expect(purchaseInvoiceImportJobsRepository.patch).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        status: PurchaseInvoiceImportJobStatus.COMPLETED,
        processedRows: 0,
      }),
    );
    // No debe insertar filas (no hay nada que reclamar) ni depender del
    // worker en segundo plano para terminar el job.
    expect(
      purchaseInvoiceImportJobRowsRepository.saveMany,
    ).not.toHaveBeenCalled();
  });
});
