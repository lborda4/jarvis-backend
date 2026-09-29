import { DOWNLOAD_XML } from './mappers/invoice-xml-download.fixture';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ElectronicDocumentService } from './electronic-document.service';
import { ElectronicDocumentStatus } from './enums/electronic-document-status.enum';
import { ElectronicDocumentType } from './enums/electronic-document-type.enum';
import { mapElectronicDocumentToListItem } from './mappers/electronic-document-list-item.mapper';

function buildQueryRunnerStub() {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
}

function buildService(document: {
  id: string;
  companyId: string;
  status: ElectronicDocumentStatus;
  siigoPurchaseId: string | null;
}) {
  const electronicDocumentsRepository = {
    findById: jest.fn().mockResolvedValue({ ...document }),
    save: jest.fn().mockImplementation((doc) => Promise.resolve(doc)),
  };
  const dataSource = {
    createQueryRunner: jest.fn().mockReturnValue(buildQueryRunnerStub()),
  };

  const service = new ElectronicDocumentService(
    dataSource as never,
    electronicDocumentsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, electronicDocumentsRepository };
}

function buildDeleteBatchService(documents: Array<{ id: string; status: ElectronicDocumentStatus }>) {
  const electronicDocumentsRepository = {
    findByCompanyAndIds: jest.fn().mockResolvedValue(documents),
    deleteByIds: jest.fn().mockResolvedValue(undefined),
  };
  const dataSource = {
    createQueryRunner: jest.fn().mockReturnValue(buildQueryRunnerStub()),
  };

  const service = new ElectronicDocumentService(
    dataSource as never,
    electronicDocumentsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, electronicDocumentsRepository };
}

it('guarda el producto SIIGO separado del código original y lo expone al recargar', async () => {
  const { service, electronicDocumentsRepository } = buildService({
    id: 'doc-product', companyId: 'company-1',
    status: ElectronicDocumentStatus.PENDING, siigoPurchaseId: null,
  });
  electronicDocumentsRepository.findById.mockResolvedValue({
    id: 'doc-product', companyId: 'company-1', status: ElectronicDocumentStatus.PENDING,
    createdAt: new Date(), updatedAt: new Date(),
    payload: { invoice: {}, items: [{
      descripcion: 'Artículo proveedor', codigo: 'SKU-PROVEEDOR',
      cantidad: 1, valorUnitario: 100, total: 100, itemType: 'Product',
      aiSuggestion: { product: { code: 'SIIGO-1', name: 'Producto SIIGO' }, confidence: 90 },
    }] },
  });
  await service.saveDraft('doc-product', 'company-1', {
    items: [{ tipo: 'Product', producto: 'SIIGO-1', description: 'Artículo proveedor',
      quantity: 1, unitValue: 100, discount: 0 }], retentionTaxIds: [],
  });
  const saved = electronicDocumentsRepository.save.mock.calls[0][0];
  expect(saved.payload.items[0].codigo).toBe('SKU-PROVEEDOR');
  expect(saved.payload.items[0].productMapping).toEqual({ code: 'SIIGO-1' });
  const response = mapElectronicDocumentToListItem(saved);
  expect(response.items[0].code).toBe('SKU-PROVEEDOR');
  expect(response.items[0].productMapping).toEqual({ code: 'SIIGO-1' });
});

it('conserva precios y descuentos originales al guardar cambios monetarios en el borrador', async () => {
  const { service, electronicDocumentsRepository } = buildService({
    id: 'doc-discount', companyId: 'company-1', status: ElectronicDocumentStatus.PENDING, siigoPurchaseId: null,
  });
  electronicDocumentsRepository.findById.mockResolvedValue({
    id: 'doc-discount', companyId: 'company-1', status: ElectronicDocumentStatus.PENDING,
    createdAt: new Date(), updatedAt: new Date(),
    payload: { invoice: {}, items: [{ descripcion: 'Producto', cantidad: 1, valorUnitario: 39900, discount: 3990, total: 30176.47, ivaPercentage: 19 }] },
  });
  await service.saveDraft('doc-discount', 'company-1', {
    items: [{ tipo: 'Account', producto: '5105', description: 'Producto', quantity: 2, unitValue: 10000, discount: 0 }], retentionTaxIds: [],
  });
  const saved = electronicDocumentsRepository.save.mock.calls[0][0];
  expect(saved.payload.items[0]).toMatchObject({ cantidad: 1, valorUnitario: 39900, discount: 3990, total: 30176.47, ivaPercentage: 19 });
  expect(saved.draft.items[0]).toMatchObject({ quantity: 2, unitValue: 10000, discount: 0 });
});

describe('ElectronicDocumentService.deleteLocalDocuments', () => {
  it('borra en un solo lote los documentos que no están en estado lista y omite los ya creados en SIIGO', async () => {
    const { service, electronicDocumentsRepository } = buildDeleteBatchService([
      { id: 'doc-1', status: ElectronicDocumentStatus.PENDING },
      { id: 'doc-2', status: ElectronicDocumentStatus.PURCHASE_CREATED },
      { id: 'doc-3', status: ElectronicDocumentStatus.ACCOUNT_REQUIRED },
    ]);

    const result = await service.deleteLocalDocuments(
      ['doc-1', 'doc-2', 'doc-3'],
      'company-1',
    );

    expect(electronicDocumentsRepository.findByCompanyAndIds).toHaveBeenCalledWith(
      'company-1',
      ['doc-1', 'doc-2', 'doc-3'],
    );
    expect(electronicDocumentsRepository.deleteByIds).toHaveBeenCalledTimes(1);
    expect(electronicDocumentsRepository.deleteByIds).toHaveBeenCalledWith([
      'doc-1',
      'doc-3',
    ]);
    expect(result).toEqual({
      deletedIds: ['doc-1', 'doc-3'],
      skippedIds: ['doc-2'],
    });
  });

  it('reporta como omitido un id que ya no existe (borrado por otra pestaña, por ejemplo) sin lanzar error', async () => {
    const { service, electronicDocumentsRepository } = buildDeleteBatchService([
      { id: 'doc-1', status: ElectronicDocumentStatus.PENDING },
    ]);

    const result = await service.deleteLocalDocuments(
      ['doc-1', 'doc-missing'],
      'company-1',
    );

    expect(result).toEqual({
      deletedIds: ['doc-1'],
      skippedIds: ['doc-missing'],
    });
  });

  it('no llama al repositorio si no llegan ids', async () => {
    const { service, electronicDocumentsRepository } = buildDeleteBatchService([]);

    const result = await service.deleteLocalDocuments([], 'company-1');

    expect(result).toEqual({ deletedIds: [], skippedIds: [] });
    expect(electronicDocumentsRepository.findByCompanyAndIds).not.toHaveBeenCalled();
  });
});

function buildAlreadyInSiigoService() {
  const integrationsRepository = {
    findByCompanyAndProvider: jest.fn((_companyId: string, provider: string) =>
      Promise.resolve(provider === 'SIIGO' ? { id: 'integration-1' } : null),
    ),
  };
  const historialFacturasRepository = {
    findByProviderInvoices: jest.fn().mockResolvedValue(
      new Map([['FE::123', { facturaId: 'siigo-purchase-1', siigoNumero: 42 }]]),
    ),
  };
  const dataSource = {
    createQueryRunner: jest.fn().mockReturnValue(buildQueryRunnerStub()),
  };

  const service = new ElectronicDocumentService(
    dataSource as never,
    {} as never,
    {} as never,
    integrationsRepository as never,
    {} as never,
    {} as never,
    historialFacturasRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, integrationsRepository, historialFacturasRepository };
}

describe('ElectronicDocumentService.resolveAlreadyInSiigoMatch', () => {
  it('devuelve el match cuando el provider_invoice del documento ya está en historial_facturas', async () => {
    const { service, historialFacturasRepository } = buildAlreadyInSiigoService();

    const match = await service.resolveAlreadyInSiigoMatch(
      {
        companyId: 'company-1',
        payload: {
          invoice: { number: 'FE123', prefix: 'FE' },
        } as never,
      },
      'company-1',
    );

    expect(match).toEqual({ facturaId: 'siigo-purchase-1', siigoNumero: 42 });
    expect(historialFacturasRepository.findByProviderInvoices).toHaveBeenCalledWith(
      'company-1',
      'integration-1',
      [{ prefix: 'FE', number: '123' }],
    );
  });

  it('devuelve null cuando no hay match', async () => {
    const { service, historialFacturasRepository } = buildAlreadyInSiigoService();
    historialFacturasRepository.findByProviderInvoices.mockResolvedValue(new Map());

    const match = await service.resolveAlreadyInSiigoMatch(
      {
        companyId: 'company-1',
        payload: { invoice: { number: 'DIAN::999' } } as never,
      },
      'company-1',
    );

    expect(match).toBeNull();
  });

  it('devuelve null sin consultar historial_facturas cuando la empresa usa Jarvis (no SIIGO)', async () => {
    const { service, integrationsRepository, historialFacturasRepository } =
      buildAlreadyInSiigoService();
    integrationsRepository.findByCompanyAndProvider.mockImplementation(
      (_companyId: string, provider: string) =>
        Promise.resolve(provider === 'JARVIS' ? { id: 'jarvis-1', active: true } : null),
    );

    const match = await service.resolveAlreadyInSiigoMatch(
      {
        companyId: 'company-1',
        payload: { invoice: { number: 'FE123', prefix: 'FE' } } as never,
      },
      'company-1',
    );

    expect(match).toBeNull();
    expect(historialFacturasRepository.findByProviderInvoices).not.toHaveBeenCalled();
  });
});

describe('ElectronicDocumentService.updateStatus', () => {
  it('ignora un intento de marcar error en un documento ya creado en SIIGO (no pisa el éxito con un fallo tardío)', async () => {
    const { service, electronicDocumentsRepository } = buildService({
      id: 'doc-1',
      companyId: 'company-1',
      status: ElectronicDocumentStatus.PURCHASE_CREATED,
      siigoPurchaseId: 'siigo-123',
    });

    const result = await service.updateStatus(
      'doc-1',
      ElectronicDocumentStatus.PURCHASE_FAILED,
      'company-1',
    );

    expect(result.status).toBe(ElectronicDocumentStatus.PURCHASE_CREATED);
    expect(electronicDocumentsRepository.save).not.toHaveBeenCalled();
  });

  it('sí actualiza el status cuando el documento no está ya creado', async () => {
    const { service, electronicDocumentsRepository } = buildService({
      id: 'doc-2',
      companyId: 'company-1',
      status: ElectronicDocumentStatus.ACCOUNT_MAPPED,
      siigoPurchaseId: null,
    });

    const result = await service.updateStatus(
      'doc-2',
      ElectronicDocumentStatus.PURCHASE_FAILED,
      'company-1',
    );

    expect(result.status).toBe(ElectronicDocumentStatus.PURCHASE_FAILED);
    expect(electronicDocumentsRepository.save).toHaveBeenCalledTimes(1);
  });
});

describe('ElectronicDocumentService.runExclusiveForDocumentCreation', () => {
  it('rechaza y no ejecuta fn si el documento ya fue creado en SIIGO (evita duplicar el envío)', async () => {
    const { service } = buildService({
      id: 'doc-3',
      companyId: 'company-1',
      status: ElectronicDocumentStatus.PURCHASE_CREATED,
      siigoPurchaseId: 'siigo-999',
    });
    const fn = jest.fn();

    await expect(
      service.runExclusiveForDocumentCreation('doc-3', 'company-1', fn),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fn).not.toHaveBeenCalled();
  });

  it('ejecuta fn y devuelve su resultado si el documento no está creado todavía', async () => {
    const { service } = buildService({
      id: 'doc-4',
      companyId: 'company-1',
      status: ElectronicDocumentStatus.ACCOUNT_MAPPED,
      siigoPurchaseId: null,
    });
    const fn = jest.fn().mockResolvedValue({ ok: true });

    const result = await service.runExclusiveForDocumentCreation(
      'doc-4',
      'company-1',
      fn,
    );

    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

function buildDownloadService(document: Record<string, unknown> | null) {
  const electronicDocumentsRepository = {
    findDownloadContext: jest.fn().mockResolvedValue(document),
  };
  const companiesRepository = {
    findById: jest.fn().mockResolvedValue(
      document && 'company' in document ? document.company : null,
    ),
  };
  const nextPymeApiClient = { getInvoiceXmlByCufe: jest.fn().mockResolvedValue(DOWNLOAD_XML) };
  const service = new ElectronicDocumentService(
    {
      createQueryRunner: jest.fn().mockReturnValue(buildQueryRunnerStub()),
    } as never,
    electronicDocumentsRepository as never,
    companiesRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    nextPymeApiClient as never,
  );

  return { service, electronicDocumentsRepository, nextPymeApiClient };
}

function buildPurchaseDocument(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'doc-download',
    companyId: 'company-1',
    cufe: 'cufe-123',
    documentNumberThird: '902086460',
    documentTypeThird: 'NIT',
    electronicDocumentType: ElectronicDocumentType.PURCHASE_INVOICE,
    payload: {
      supplier: {
        documentNumber: '902086460',
        documentType: 'NIT',
        name: 'Proveedor S.A.S',
      },
      invoice: {
        cufe: 'cufe-123',
        number: 'SETP1',
        issueDate: '2026-07-21',
        currency: 'COP',
      },
      items: [
        {
          descripcion: 'Ítem',
          cantidad: 1,
          valorUnitario: 10000,
          total: 10000,
        },
      ],
      taxes: [],
      totals: { subtotal: 10000, iva: 0, total: 10000 },
    },
    company: {
      id: 'company-1',
      nextPymeToken: 'company-token',
      nit: '900123456',
      name: 'Compradora S.A.S',
      cityName: 'Medellín',
    },
    ...overrides,
  };
}

describe('ElectronicDocumentService.getPurchaseInvoiceDownload', () => {
  it.each([undefined, { nextPymeToken: null }, { nextPymeToken: '   ' }])('requires the token of the owning company before requesting XML', async company => {
    const { service, nextPymeApiClient } = buildDownloadService(buildPurchaseDocument({ company }));
    await expect(service.getPurchaseInvoiceDownload('doc-download', 'company-1')).rejects.toThrow('La empresa no tiene un token');
    expect(nextPymeApiClient.getInvoiceXmlByCufe).not.toHaveBeenCalled();
  });

  it('uses company authentication and XML values even when payload differs', async () => {
    const document = buildPurchaseDocument({ company: { nextPymeToken: 'company-token' } });
    const { service, nextPymeApiClient, electronicDocumentsRepository } = buildDownloadService(document);
    const dto = await service.getPurchaseInvoiceDownload('doc-download', 'company-1');
    expect(nextPymeApiClient.getInvoiceXmlByCufe).toHaveBeenCalledWith('cufe-123', 'company-token');
    expect(electronicDocumentsRepository.findDownloadContext).toHaveBeenCalledWith('doc-download');
    expect(dto.total).toBe(238);
    expect(dto.issuer.name).toBe('Proveedor XML');
  });

  it('does not contact NextPyme for another company', async () => {
    const { service, nextPymeApiClient } = buildDownloadService(buildPurchaseDocument({ companyId: 'other' }));
    await expect(service.getPurchaseInvoiceDownload('doc-download', 'company-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(nextPymeApiClient.getInvoiceXmlByCufe).not.toHaveBeenCalled();
  });

  it('propagates upstream failure without falling back to the saved payload', async () => {
    const { service, nextPymeApiClient } = buildDownloadService(buildPurchaseDocument());
    nextPymeApiClient.getInvoiceXmlByCufe.mockRejectedValue(new Error('NextPyme unavailable'));
    await expect(service.getPurchaseInvoiceDownload('doc-download', 'company-1')).rejects.toThrow('NextPyme unavailable');
  });

  it('works with download metadata only, without loading payload or draft', async () => {
    const { service } = buildDownloadService(buildPurchaseDocument({ payload: undefined }));
    await expect(service.getPurchaseInvoiceDownload('doc-download', 'company-1')).resolves.toMatchObject({ total: 238 });
  });

  it('devuelve el DTO visual de una factura de compra con CUFE', async () => {
    const { service } = buildDownloadService(buildPurchaseDocument());

    const dto = await service.getPurchaseInvoiceDownload(
      'doc-download',
      'company-1',
    );

    expect(dto.cufe).toBe('cufe-123');
    expect(dto.invoiceNumber).toBe('XML1');
    expect(dto.buyer.documentNumber).toBe('900123456');
    expect(dto.dianQrText).toContain('CUFE: cufe-123');
  });

  it('rechaza un documento soporte', async () => {
    const { service } = buildDownloadService(
      buildPurchaseDocument({
        electronicDocumentType: ElectronicDocumentType.SUPPORT_DOCUMENT,
      }),
    );

    await expect(
      service.getPurchaseInvoiceDownload('doc-download', 'company-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza una factura de compra sin CUFE', async () => {
    const { service } = buildDownloadService(
      buildPurchaseDocument({
        cufe: null,
        payload: {
          supplier: {
            documentNumber: '1',
            documentType: 'NIT',
            name: 'Proveedor',
          },
          invoice: { cufe: '', number: 'FE1', issueDate: '2026-01-01', currency: 'COP' },
          items: [],
          taxes: [],
          totals: { subtotal: 0, iva: 0, total: 0 },
        },
      }),
    );

    await expect(
      service.getPurchaseInvoiceDownload('doc-download', 'company-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un documento de otra empresa', async () => {
    const { service } = buildDownloadService(
      buildPurchaseDocument({ companyId: 'company-other' }),
    );

    await expect(
      service.getPurchaseInvoiceDownload('doc-download', 'company-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
