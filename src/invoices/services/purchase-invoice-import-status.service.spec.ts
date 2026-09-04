import { PurchaseInvoiceImportStatusService } from './purchase-invoice-import-status.service';
import { PurchaseInvoiceImportJobStatus } from '../enums/purchase-invoice-import-job-status.enum';

function buildJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    companyId: 'company-1',
    status: PurchaseInvoiceImportJobStatus.COMPLETED,
    fileName: 'facturas.xlsx',
    processedRows: 0,
    totalRows: 0,
    itemsTotal: null,
    documentsCreated: null,
    documentIds: null,
    records: null,
    validationReport: null,
    errorMessage: null,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-01T00:00:01Z'),
    ...overrides,
  } as never;
}

function buildService(countsByStatus: Array<{ status: string; count: number }>) {
  const purchaseInvoiceImportJobRowsRepository = {
    countByStatus: jest.fn().mockResolvedValue(countsByStatus),
    findFailedByJob: jest.fn().mockResolvedValue([]),
  };

  const service = new PurchaseInvoiceImportStatusService(
    {} as never,
    purchaseInvoiceImportJobRowsRepository as never,
  );

  return { service, purchaseInvoiceImportJobRowsRepository };
}

describe('PurchaseInvoiceImportStatusService.buildImportStatusResponse', () => {
  it('progressPercent=100 para un job COMPLETED con totalRows=0 (bug real: 0 es falsy, antes daba null y la barra quedaba sin completar)', async () => {
    const { service } = buildService([]);

    const status = await service.buildImportStatusResponse(
      buildJob({ totalRows: 0 }),
    );

    expect(status.progressPercent).toBe(100);
  });

  it('progressPercent=null mientras totalRows todavía no se conoce (no confundir con el caso de 0 filas)', async () => {
    const { service } = buildService([]);

    const status = await service.buildImportStatusResponse(
      buildJob({ totalRows: null, status: PurchaseInvoiceImportJobStatus.PENDING }),
    );

    expect(status.progressPercent).toBeNull();
  });

  it('calcula el porcentaje normal cuando sí hay filas', async () => {
    const { service } = buildService([
      { status: 'success', count: 3 },
      { status: 'failed', count: 1 },
    ]);

    const status = await service.buildImportStatusResponse(
      buildJob({ totalRows: 8 }),
    );

    expect(status.progressPercent).toBe(50);
  });
});
