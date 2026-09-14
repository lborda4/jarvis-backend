import { SiigoSupportDocumentCreationHandler } from './siigo-support-document-creation.handler';
import { ElectronicDocumentStatus } from '../../../electronic-document/enums/electronic-document-status.enum';

function buildDocumentStub(costCenterCode?: string) {
  return {
    id: 'doc-1',
    companyId: 'company-1',
    status: ElectronicDocumentStatus.ACCOUNT_MAPPED,
    payload: {
      supplier: {
        documentNumber: '900123456',
        documentType: 'NIT',
        name: 'Proveedor',
      },
      invoice: {
        cufe: 'cufe-1',
        number: '100',
        issueDate: '2026-01-01',
        currency: 'COP',
      },
      items: [
        {
          descripcion: 'Item',
          cantidad: 1,
          valorUnitario: 1000,
          total: 1000,
          accountMapping: { code: '5135', name: 'Cuenta' },
        },
      ],
      taxes: [],
      totals: { subtotal: 1000, iva: 0, total: 1000 },
      ...(costCenterCode ? { costCenterCode } : {}),
    },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as never;
}

interface SentSupportDocumentPayload {
  cost_center?: number;
}

function buildHandler(costCenterCode?: string) {
  let sentPayload: SentSupportDocumentPayload | undefined;
  const electronicDocumentService = {
    requireById: jest.fn().mockResolvedValue(buildDocumentStub(costCenterCode)),
    runExclusiveForDocumentCreation: jest.fn(
      async (_id: string, _companyId: string, fn: () => Promise<unknown>) =>
        fn(),
    ),
    markPurchaseCreated: jest
      .fn()
      .mockResolvedValue(buildDocumentStub(costCenterCode)),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
  const siigoAuthService = {
    getValidAuthContext: jest
      .fn()
      .mockResolvedValue({ accessToken: 'token-1', partnerId: 'partner-1' }),
  };
  const siigoHttpClient = {
    createSupportDocument: jest.fn(
      (_accessToken: string, payload: SentSupportDocumentPayload) => {
        sentPayload = payload;

        return Promise.resolve({
          id: 'siigo-doc-1',
          number: 1,
          name: 'DS-1',
          date: '2026-01-01',
          total: 1000,
          supplier_receipt_number: { prefix: 'DS', number: '100' },
        });
      },
    ),
  };
  const siigoConfigurationCacheService = {
    getSupportDocumentTypeId: jest.fn().mockResolvedValue(1),
    getSupportDocumentConfig: jest.fn().mockResolvedValue({
      documentId: 1,
      defaultTaxId: 1,
      sendStamp: false,
      paymentTypeId: 1,
    }),
  };
  const siigoCostCentersCatalogService = {
    listCostCenters: jest
      .fn()
      .mockResolvedValue([{ id: 7, code: '001', name: 'Administración' }]),
  };

  const handler = new SiigoSupportDocumentCreationHandler(
    siigoAuthService as never,
    siigoHttpClient as never,
    electronicDocumentService as never,
    siigoConfigurationCacheService as never,
    siigoCostCentersCatalogService as never,
  );

  return {
    handler,
    siigoHttpClient,
    siigoCostCentersCatalogService,
    getSentPayload: () => sentPayload,
  };
}

describe('SiigoSupportDocumentCreationHandler — centro de costos importado del Excel', () => {
  it('resuelve el código del Excel contra el catálogo y lo manda como cost_center', async () => {
    const { handler, siigoHttpClient, siigoCostCentersCatalogService } =
      buildHandler('001 - Administración');

    await handler.create('doc-1', 'company-1');

    expect(siigoCostCentersCatalogService.listCostCenters).toHaveBeenCalledWith(
      'company-1',
    );
    expect(siigoHttpClient.createSupportDocument).toHaveBeenCalledWith(
      'token-1',
      expect.objectContaining({ cost_center: 7 }),
      'partner-1',
    );
  });

  it('si el Excel no traía centro de costos, no consulta el catálogo ni manda cost_center', async () => {
    const { handler, siigoCostCentersCatalogService, getSentPayload } =
      buildHandler(undefined);

    await handler.create('doc-1', 'company-1');

    expect(
      siigoCostCentersCatalogService.listCostCenters,
    ).not.toHaveBeenCalled();
    expect(getSentPayload()?.cost_center).toBeUndefined();
  });

  it('si el texto del Excel no matchea ningún centro de costos activo, envía igual sin cost_center (no bloquea el documento)', async () => {
    const { handler, getSentPayload } = buildHandler('Marketing');

    await handler.create('doc-1', 'company-1');

    expect(getSentPayload()?.cost_center).toBeUndefined();
  });
});
