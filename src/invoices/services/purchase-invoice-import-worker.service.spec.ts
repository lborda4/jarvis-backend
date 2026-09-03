import { PurchaseInvoiceImportWorkerService } from './purchase-invoice-import-worker.service';
import { PurchaseInvoiceImportJobStatus } from '../enums/purchase-invoice-import-job-status.enum';
import { PurchaseInvoiceImportRowStatus } from '../enums/purchase-invoice-import-row-status.enum';
import type { DianSalesInvoiceRow } from '../helpers/sales-invoice-excel.helper';

function buildRawRow(
  overrides: Partial<DianSalesInvoiceRow> = {},
): DianSalesInvoiceRow {
  return {
    cufe: 'cufe-1',
    documentType: 'Factura electrónica',
    folio: '1',
    prefix: 'F',
    currency: 'COP',
    paymentForm: 'Contado',
    paymentMethod: 'Efectivo',
    issueDate: '01-01-2026',
    receptionDate: '01-01-2026',
    issuerNit: '900123456',
    issuerName: 'Proveedor SAS',
    receiverNit: '800123456',
    receiverName: 'Empresa SAS',
    iva: 0,
    total: 100000,
    status: 'ok',
    group: 'Recibido',
    ...overrides,
  };
}

function buildJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    jobId: 'job-1',
    rowIndex: 1,
    cufe: 'cufe-1',
    issuerNit: '900123456',
    issuerName: 'Proveedor SAS',
    status: PurchaseInvoiceImportRowStatus.PROCESSING,
    errorMessage: null,
    documentId: null,
    rawRow: buildRawRow(),
    processedAt: null,
    processingAt: new Date(),
    attempts: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

function buildJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    companyId: 'company-1',
    status: PurchaseInvoiceImportJobStatus.RUNNING,
    fileName: 'facturas.xlsx',
    processedRows: 0,
    totalRows: 2,
    itemsTotal: null,
    documentsCreated: null,
    documentIds: null,
    records: null,
    validationReport: null,
    errorMessage: null,
    startedAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

function buildService(
  overrides: {
    jobRowsRepository?: Record<string, unknown>;
    jobsRepository?: Record<string, unknown>;
    electronicDocumentService?: Record<string, unknown>;
    nextPymeApiClient?: Record<string, unknown>;
  } = {},
) {
  const jobsRepository = {
    patch: jest.fn().mockResolvedValue(undefined),
    ...overrides.jobsRepository,
  };
  const jobRowsRepository = {
    countOutstandingByJob: jest.fn().mockResolvedValue(0),
    claimPendingBatch: jest.fn().mockResolvedValue([]),
    saveMany: jest.fn().mockResolvedValue(undefined),
    countByStatus: jest.fn().mockResolvedValue([]),
    ...overrides.jobRowsRepository,
  };
  const electronicDocumentService = {
    createFromPurchaseInvoiceRows: jest.fn(),
    resolveDocumentProvider: jest.fn().mockResolvedValue('SIIGO'),
    ...overrides.electronicDocumentService,
  };
  const nextPymeApiClient = {
    getInvoiceByCufe: jest.fn(),
    ...overrides.nextPymeApiClient,
  };
  const companiesRepository = { findById: jest.fn().mockResolvedValue(null) };
  const siigoDocumentPreparationService = {
    prepareDocumentsInBackground: jest.fn(),
  };
  const siigoPurchaseAiClassificationService = {
    classifyDocumentsInBackground: jest.fn(),
  };
  const jarvisDocumentPreparationService = {
    prepareDocumentsInBackground: jest.fn(),
  };
  const statusService = {
    getStatus: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
  };
  const postgresNotifyService = {
    publish: jest.fn().mockResolvedValue(undefined),
  };
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        'purchaseInvoiceImport.batchSize': 20,
        'purchaseInvoiceImport.concurrency': 4,
        'purchaseInvoiceImport.processingTimeoutMinutes': 10,
        'purchaseInvoiceImport.workerPollIntervalMs': 2000,
      };
      return values[key];
    }),
  };

  const service = new PurchaseInvoiceImportWorkerService(
    configService as any,
    companiesRepository as any,
    electronicDocumentService as any,
    nextPymeApiClient as any,
    siigoDocumentPreparationService as any,
    siigoPurchaseAiClassificationService as any,
    jarvisDocumentPreparationService as any,
    jobsRepository as any,
    jobRowsRepository as any,
    statusService as any,
    postgresNotifyService as any,
  );

  return {
    service,
    jobsRepository,
    jobRowsRepository,
    electronicDocumentService,
    nextPymeApiClient,
    siigoDocumentPreparationService,
    postgresNotifyService,
  };
}

describe('PurchaseInvoiceImportWorkerService.processOneBatchForJob (private, vía cast)', () => {
  it('separa filas exitosas de fallidas y solo crea documentos para las exitosas del lote', async () => {
    const successRow = buildJobRow({
      id: 'row-1',
      rowIndex: 1,
      cufe: 'cufe-ok',
      rawRow: buildRawRow({ cufe: 'cufe-ok' }),
    });
    const failedRow = buildJobRow({
      id: 'row-2',
      rowIndex: 2,
      cufe: 'cufe-missing',
      rawRow: buildRawRow({ cufe: 'cufe-missing' }),
    });

    const {
      service,
      jobRowsRepository,
      electronicDocumentService,
      nextPymeApiClient,
    } = buildService({
      jobRowsRepository: {
        countOutstandingByJob: jest.fn().mockResolvedValue(2),
        claimPendingBatch: jest.fn().mockResolvedValue([successRow, failedRow]),
      },
      nextPymeApiClient: {
        getInvoiceByCufe: jest.fn((cufe: string) =>
          cufe === 'cufe-ok'
            ? Promise.resolve({
                outcome: 'found',
                data: {
                  seller: { identification_number: '900123456' },
                  legal_monetary_totals: { payable_amount: '100000' },
                  invoice_lines: [],
                },
                attempts: 1,
                retryDelayMs: 0,
              })
            : Promise.resolve({
                outcome: 'not_found',
                attempts: 1,
                retryDelayMs: 0,
              }),
        ),
      },
      electronicDocumentService: {
        createFromPurchaseInvoiceRows: jest.fn().mockResolvedValue({
          documentsCreated: 1,
          documentsReused: 0,
          itemsTotal: 1,
          documentsSkippedByPlanLimit: 0,
          rows: [
            { cufe: 'cufe-ok', documentId: 'doc-1', skippedByPlanLimit: false },
          ],
        }),
      },
    });

    await (service as any).processOneBatchForJob(buildJob());

    // Solo se le pide crear documentos a NextPyme por la fila exitosa —
    // la fallida (not_found) nunca llega a createFromPurchaseInvoiceRows.
    expect(
      electronicDocumentService.createFromPurchaseInvoiceRows,
    ).toHaveBeenCalledTimes(1);
    const [rowsWithPayload] =
      electronicDocumentService.createFromPurchaseInvoiceRows.mock.calls[0];
    expect(rowsWithPayload).toHaveLength(1);

    // Ambas filas del lote quedan persistidas con su resultado final.
    const savedBatches = jobRowsRepository.saveMany.mock.calls;
    const allSavedRows = savedBatches.flatMap(([rows]) => rows);
    const savedSuccess = allSavedRows.find((row: any) => row.id === 'row-1');
    const savedFailed = allSavedRows.find((row: any) => row.id === 'row-2');

    expect(savedSuccess.status).toBe(PurchaseInvoiceImportRowStatus.SUCCESS);
    expect(savedSuccess.documentId).toBe('doc-1');
    expect(savedFailed.status).toBe(PurchaseInvoiceImportRowStatus.FAILED);
    expect(savedFailed.errorMessage).toContain('No se encontró la factura');
    expect(nextPymeApiClient.getInvoiceByCufe).toHaveBeenCalledTimes(2);
  });

  it('no aborta ni consulta el cupo del plan al importar, aunque el plan ya esté agotado', async () => {
    // El cupo del plan ya no se descuenta/valida al importar — solo al
    // ENVIAR a SIIGO (ver assertCanCreateDocuments en
    // SiigoPurchaseSendService). Un plan agotado no debe impedir crear los
    // registros locales de la importación.
    const successRow = buildJobRow({
      id: 'row-1',
      rowIndex: 1,
      cufe: 'cufe-ok',
      rawRow: buildRawRow({ cufe: 'cufe-ok' }),
    });

    const { service, nextPymeApiClient, electronicDocumentService } =
      buildService({
        jobRowsRepository: {
          countOutstandingByJob: jest.fn().mockResolvedValue(1),
          claimPendingBatch: jest.fn().mockResolvedValue([successRow]),
        },
        nextPymeApiClient: {
          getInvoiceByCufe: jest.fn().mockResolvedValue({
            outcome: 'found',
            data: {
              seller: { identification_number: '900123456' },
              legal_monetary_totals: { payable_amount: '100000' },
              invoice_lines: [],
            },
            attempts: 1,
            retryDelayMs: 0,
          }),
        },
        electronicDocumentService: {
          createFromPurchaseInvoiceRows: jest.fn().mockResolvedValue({
            documentsCreated: 1,
            documentsReused: 0,
            itemsTotal: 1,
            documentsSkippedByPlanLimit: 0,
            rows: [
              { cufe: 'cufe-ok', documentId: 'doc-1', skippedByPlanLimit: false },
            ],
          }),
        },
      });

    await (service as any).processOneBatchForJob(buildJob());

    expect(nextPymeApiClient.getInvoiceByCufe).toHaveBeenCalledTimes(1);
    expect(
      electronicDocumentService.createFromPurchaseInvoiceRows,
    ).toHaveBeenCalledTimes(1);
  });

  it('finaliza el job como completed cuando no quedan filas pending/processing', async () => {
    const {
      service,
      jobsRepository,
      jobRowsRepository,
      postgresNotifyService,
    } = buildService({
      jobRowsRepository: {
        countOutstandingByJob: jest.fn().mockResolvedValue(0),
        countByStatus: jest
          .fn()
          .mockResolvedValue([
            { status: PurchaseInvoiceImportRowStatus.FAILED, count: 1 },
          ]),
      },
    });

    await (service as any).processOneBatchForJob(buildJob());

    expect(jobRowsRepository.claimPendingBatch).not.toHaveBeenCalled();
    expect(jobsRepository.patch).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        status: PurchaseInvoiceImportJobStatus.COMPLETED,
      }),
    );
    expect(postgresNotifyService.publish).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'completed' }),
    );
  });
});
