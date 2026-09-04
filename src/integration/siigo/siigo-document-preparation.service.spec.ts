import { SiigoDocumentPreparationService } from './siigo-document-preparation.service';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';

function buildService(
  electronicDocumentService: any = {},
): SiigoDocumentPreparationService {
  return new SiigoDocumentPreparationService(
    electronicDocumentService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe('SiigoDocumentPreparationService.prepareDocuments', () => {
  it('nunca procesa más documentos en simultáneo que el límite de concurrencia acotada', async () => {
    const service = buildService();
    jest.spyOn(service as any, 'createBatchContext').mockResolvedValue({});

    let inFlight = 0;
    let maxInFlight = 0;

    jest
      .spyOn(service, 'prepareSupplierAndAccounts')
      .mockImplementation(async (documentId: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;

        return { documentId, nextStep: 'READY' } as any;
      });

    const documentIds = Array.from({ length: 23 }, (_, i) => `doc-${i}`);
    await service.prepareDocuments(documentIds, 'company-1');

    expect(service.prepareSupplierAndAccounts).toHaveBeenCalledTimes(23);
    // Un import de 500+ filas no debe disparar 500+ llamadas en paralelo
    // contra SIIGO — este es el assert que revienta si alguien vuelve a un
    // Promise.all sin límite.
    expect(maxInFlight).toBeLessThanOrEqual(5);
    // Pero tampoco se volvió secuencial: sí hay trabajo en paralelo.
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('un documento que falla no bloquea ni detiene al resto del lote', async () => {
    const service = buildService();
    jest.spyOn(service as any, 'createBatchContext').mockResolvedValue({});

    jest
      .spyOn(service, 'prepareSupplierAndAccounts')
      .mockImplementation(async (documentId: string) => {
        if (documentId === 'doc-2') {
          throw new Error('fallo puntual de SIIGO');
        }

        return { documentId, nextStep: 'READY' } as any;
      });

    const documentIds = ['doc-1', 'doc-2', 'doc-3'];
    await service.prepareDocuments(documentIds, 'company-1');

    expect(service.prepareSupplierAndAccounts).toHaveBeenCalledTimes(3);
  });

  it('marca el documento como FAILED cuando su preparación revienta, en vez de dejarlo congelado sin ningún indicio', async () => {
    const electronicDocumentService = { updateStatus: jest.fn() };
    const service = buildService(electronicDocumentService);
    jest.spyOn(service as any, 'createBatchContext').mockResolvedValue({});

    jest
      .spyOn(service, 'prepareSupplierAndAccounts')
      .mockImplementation(async (documentId: string) => {
        if (documentId === 'doc-2') {
          throw new Error('rate limit de SIIGO agotado');
        }

        return { documentId, nextStep: 'READY' } as any;
      });

    await service.prepareDocuments(['doc-1', 'doc-2', 'doc-3'], 'company-1');

    expect(electronicDocumentService.updateStatus).toHaveBeenCalledTimes(1);
    expect(electronicDocumentService.updateStatus).toHaveBeenCalledWith(
      'doc-2',
      ElectronicDocumentStatus.FAILED,
      'company-1',
    );
  });

  it('un documento que no se puede marcar como FAILED (la propia actualización falla) no bloquea al resto del lote', async () => {
    const electronicDocumentService = {
      updateStatus: jest.fn().mockRejectedValue(new Error('DB caída')),
    };
    const service = buildService(electronicDocumentService);
    jest.spyOn(service as any, 'createBatchContext').mockResolvedValue({});

    jest
      .spyOn(service, 'prepareSupplierAndAccounts')
      .mockImplementation(async (documentId: string) => {
        if (documentId === 'doc-1') {
          throw new Error('fallo puntual de SIIGO');
        }

        return { documentId, nextStep: 'READY' } as any;
      });

    await expect(
      service.prepareDocuments(['doc-1', 'doc-2'], 'company-1'),
    ).resolves.toBeUndefined();

    expect(service.prepareSupplierAndAccounts).toHaveBeenCalledTimes(2);
  });

  it('procesa un lote vacío sin errores', async () => {
    const service = buildService();
    jest.spyOn(service as any, 'createBatchContext').mockResolvedValue({});
    const spy = jest.spyOn(service, 'prepareSupplierAndAccounts');

    await expect(
      service.prepareDocuments([], 'company-1'),
    ).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('SiigoDocumentPreparationService.prepareSupplierAndAccounts', () => {
  function buildDocumentStub(status: ElectronicDocumentStatus) {
    return {
      id: 'doc-1',
      companyId: 'company-1',
      status,
      supplierExistsInSiigo: null,
      payload: { supplier: {}, invoice: { number: 'FE123', prefix: 'FE' } },
    } as any;
  }

  it('si la factura ya existe en SIIGO (detectada por provider_invoice), la marca lista sin validar proveedor ni cuenta — el sync pudo traerla DESPUÉS de importarla', async () => {
    const electronicDocumentService = {
      requireById: jest.fn().mockResolvedValue(buildDocumentStub(ElectronicDocumentStatus.PENDING)),
      resolveAlreadyInSiigoMatch: jest.fn().mockResolvedValue({
        facturaId: 'siigo-purchase-1',
        siigoNumero: 42,
      }),
      markPurchaseCreated: jest.fn().mockResolvedValue(
        buildDocumentStub(ElectronicDocumentStatus.PURCHASE_CREATED),
      ),
    };
    const siigoValidationService = { validateImport: jest.fn() };
    const siigoAccountMappingService = { validateAccountMapping: jest.fn() };
    const service = new SiigoDocumentPreparationService(
      electronicDocumentService as any,
      siigoValidationService as any,
      siigoAccountMappingService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.prepareSupplierAndAccounts('doc-1', 'company-1');

    expect(result).toEqual({ documentId: 'doc-1', nextStep: 'READY' });
    expect(electronicDocumentService.markPurchaseCreated).toHaveBeenCalledWith(
      'doc-1',
      'siigo-purchase-1',
      'company-1',
      42,
    );
    expect(siigoValidationService.validateImport).not.toHaveBeenCalled();
    expect(siigoAccountMappingService.validateAccountMapping).not.toHaveBeenCalled();
  });

  it('si no hay match por provider_invoice, sigue el flujo normal de validar proveedor', async () => {
    const electronicDocumentService = {
      requireById: jest.fn().mockResolvedValue(buildDocumentStub(ElectronicDocumentStatus.PENDING)),
      resolveAlreadyInSiigoMatch: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn(),
      updateSupplierExistsInSiigo: jest.fn(),
    };
    const siigoValidationService = {
      validateImport: jest.fn().mockResolvedValue({ status: 'SUPPLIER_FOUND' }),
    };
    const siigoAccountMappingService = {
      validateAccountMapping: jest.fn().mockResolvedValue({ status: 'READY' }),
    };
    const service = new SiigoDocumentPreparationService(
      electronicDocumentService as any,
      siigoValidationService as any,
      siigoAccountMappingService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.prepareSupplierAndAccounts('doc-1', 'company-1');

    expect(electronicDocumentService.resolveAlreadyInSiigoMatch).toHaveBeenCalledTimes(1);
    expect(siigoValidationService.validateImport).toHaveBeenCalledTimes(1);
    expect(result.nextStep).toBe('READY');
  });

  it('un documento ya PURCHASE_CREATED no vuelve a chequear provider_invoice (ya se sabe que existe)', async () => {
    const electronicDocumentService = {
      requireById: jest.fn().mockResolvedValue({
        ...buildDocumentStub(ElectronicDocumentStatus.PURCHASE_CREATED),
        supplierExistsInSiigo: true,
      }),
      resolveAlreadyInSiigoMatch: jest.fn(),
    };
    const service = new SiigoDocumentPreparationService(
      electronicDocumentService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.prepareSupplierAndAccounts('doc-1', 'company-1');

    expect(electronicDocumentService.resolveAlreadyInSiigoMatch).not.toHaveBeenCalled();
    expect(result.nextStep).toBe('READY');
  });
});
