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
    saveMany: jest.fn().mockResolvedValue(undefined),
  };

  const service = new InvoicesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    purchaseInvoiceImportJobsRepository as never,
    purchaseInvoiceImportJobRowsRepository as never,
    {} as never,
  );

  return {
    service,
    purchaseInvoiceImportJobsRepository,
    purchaseInvoiceImportJobRowsRepository,
  };
}

describe('InvoicesService.importPurchaseInvoicesFromExcel', () => {
  afterEach(() => {
    jest.clearAllMocks();
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
    expect(purchaseInvoiceImportJobRowsRepository.saveMany).not.toHaveBeenCalled();
  });
});
