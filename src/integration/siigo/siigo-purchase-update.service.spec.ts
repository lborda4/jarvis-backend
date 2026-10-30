import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { SiigoPurchaseSendService } from './siigo-purchase-send.service';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { UpdateSiigoPurchaseRequestDto } from './dto/create-siigo-purchase-send.dto';
jest.mock('./helpers/siigo-support-document-preference.helper', () => ({
  buildSupplierPreferenceSnapshotFromSendRequest: jest.fn(() => null),
  persistSupplierPreferencesFromSendRequest: jest.fn(),
  persistHistorialFacturaFromSendRequest: jest.fn(),
}));
jest.mock('./helpers/siigo-context.helper', () => ({
  getSiigoIntegration: jest.fn(async () => ({ id: 'integration' })),
}));
jest.mock('./helpers/siigo-request-retry.helper', () => ({
  executeSiigoRequestWithRetries: jest.fn(
    (_auth, _company, _logger, _action, fn) => fn('token', 'partner'),
  ),
}));
jest.mock(
  '../../electronic-document/mappers/electronic-document-response.mapper',
  () => ({ mapElectronicDocumentToResponse: (doc) => doc }),
);
describe('Actualizar compras enviadas sin crear otra factura', () => {
  function setup() {
    const document = {
      id: 'local',
      alreadyInSiigo: false,
      electronicDocumentType: ElectronicDocumentType.PURCHASE_INVOICE,
      status: ElectronicDocumentStatus.PURCHASE_CREATED,
      siigoPurchaseId: 'remote',
      payload: {},
    };
    const documents = {
      requireById: jest.fn(async () => document),
      updateStatus: jest.fn(),
      runExclusiveForPurchaseUpdate: jest.fn(
        async (_id, _company, _remote, fn) => fn(),
      ),
      markPurchaseCreated: jest.fn(async () => document),
      saveDraft: jest.fn(),
      runExclusiveForDocumentCreation: jest.fn(),
    };
    const existing = {
      id: 'remote',
      document: { id: 81 },
      number: 123,
      supplier: { identification: '9001', branch_office: 2 },
      currency: { code: 'COP', exchange_rate: 1 },
      date: '2026-10-01',
      total: 108000,
      provider_invoice: { prefix: 'FC', number: '10' },
    };
    const http = {
      getPurchase: jest.fn(async () => existing),
      updatePurchase: jest.fn(async () => existing),
      createPurchase: jest.fn(),
    };
    const plans = {
      assertCanCreateDocuments: jest.fn(),
      withSiigoQuotaLock: jest.fn(),
    };
    const config = {
      getPurchaseConfig: jest.fn(),
      getPurchaseDocumentTypeId: jest.fn(),
    };
    const service = new SiigoPurchaseSendService(
      documents as never,
      {} as never,
      config as never,
      http as never,
      {
        listTaxes: jest.fn(async () => [
          { id: 8, type: 'Impoconsumo', percentage: 8, active: true },
        ]),
      } as never,
      {
        listAccounts: jest.fn(async () => [{ code: '5101', name: 'Compra' }]),
      } as never,
      {} as never,
      { run: jest.fn((_company, fn) => fn()) } as never,
      plans as never,
      {} as never,
      {} as never,
    );
    const request: UpdateSiigoPurchaseRequestDto = {
      documentId: 'local',
      supplier: { identification: '9001' },
      date: '2026-10-01',
      provider_invoice: { prefix: 'FC', number: '10' },
      items: [{ code: '5101', quantity: 1, price: 100000, taxes: [{ id: 8 }] }],
      payments: [{ id: 1, value: 108000 }],
      draft: {
        items: [
          {
            tipo: 'Account',
            producto: '5101',
            description: 'Compra',
            quantity: 1,
            unitValue: 100000,
            discount: 0,
            impoconsumoTaxId: 8,
          },
        ],
      },
    };
    return {
      service,
      documents,
      document,
      http,
      plans,
      config,
      request,
      existing,
    };
  }
  it('actualiza el mismo UUID, conserva campos inmutables y envía INC; no consume cupo ni crea', async () => {
    const { service, documents, http, plans, config, request } = setup();
    const result = await service.updatePurchase(request, 'company');
    expect(http.getPurchase).toHaveBeenCalledWith('token', 'remote', 'partner');
    expect(http.updatePurchase).toHaveBeenCalledWith(
      'token',
      'remote',
      expect.objectContaining({
        document: { id: 81 },
        number: 123,
        supplier: { identification: '9001', branch_office: 2 },
        currency: { code: 'COP', exchange_rate: 1 },
        items: [expect.objectContaining({ taxes: [{ id: 8 }] })],
        payments: [{ id: 1, value: 108000 }],
      }),
      'partner',
    );
    expect(http.createPurchase).not.toHaveBeenCalled();
    expect(plans.assertCanCreateDocuments).not.toHaveBeenCalled();
    expect(config.getPurchaseConfig).not.toHaveBeenCalled();
    expect(config.getPurchaseDocumentTypeId).not.toHaveBeenCalled();
    expect(documents.runExclusiveForDocumentCreation).not.toHaveBeenCalled();
    expect(documents.runExclusiveForPurchaseUpdate).toHaveBeenCalledWith(
      'local',
      'company',
      'remote',
      expect.any(Function),
    );
    expect(documents.saveDraft).toHaveBeenCalledWith(
      'local',
      'company',
      request.draft,
      true,
    );
    expect(result.success).toBe(true);
  });
  it('conserva enviada y el borrador confirmado si SIIGO rechaza la modificación', async () => {
    const { service, documents, http, request } = setup();
    http.updatePurchase.mockRejectedValue(
      new BadGatewayException('Comprobante con pagos'),
    );
    await expect(service.updatePurchase(request, 'company')).rejects.toThrow(
      'Comprobante con pagos',
    );
    expect(documents.updateStatus).not.toHaveBeenCalled();
    expect(documents.saveDraft).not.toHaveBeenCalled();
    expect(documents.markPurchaseCreated).not.toHaveBeenCalled();
    expect(http.createPurchase).not.toHaveBeenCalled();
  });
  it('rechaza cambiar el proveedor antes de modificar SIIGO', async () => {
    const { service, http, request } = setup();
    request.supplier.identification = 'otra';
    await expect(service.updatePurchase(request, 'company')).rejects.toThrow(
      'proveedor',
    );
    expect(http.updatePurchase).not.toHaveBeenCalled();
  });
  it('rechaza documentos sin envío confirmado', async () => {
    const { service, document, http, request } = setup();
    document.status = ElectronicDocumentStatus.ACCOUNT_MAPPED;
    await expect(
      service.updatePurchase(request, 'company'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(http.getPurchase).not.toHaveBeenCalled();
  });
  it('rechaza compras creadas directamente en SIIGO antes de consultar o modificar al proveedor', async () => {
    const { service, document, documents, http, request } = setup();
    document.alreadyInSiigo = true;
    await expect(service.updatePurchase(request, 'company')).rejects.toThrow('enviadas desde JARVIS');
    expect(http.getPurchase).not.toHaveBeenCalled();
    expect(http.updatePurchase).not.toHaveBeenCalled();
    expect(documents.runExclusiveForPurchaseUpdate).not.toHaveBeenCalled();
  });
  it('consulta siempre con el ámbito de empresa y proveedor SIIGO', async () => {
    const { service, documents, request } = setup();
    await service.updatePurchase(request, 'company');
    expect(documents.requireById).toHaveBeenCalledWith(
      'local',
      'company',
      'SIIGO',
    );
  });
});
