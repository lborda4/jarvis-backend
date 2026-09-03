import { SiigoDocumentResumeService } from './siigo-document-resume.service';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';

function buildDocumentStub(status: ElectronicDocumentStatus) {
  return {
    id: 'doc-1',
    companyId: 'company-1',
    cufe: 'cufe-1',
    documentNumberThird: null,
    documentTypeThird: null,
    status,
    electronicDocumentType: 'PURCHASE_INVOICE',
    siigoDocumentNumber: null,
    supplierExistsInSiigo: true,
    payload: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as never;
}

function buildService(status: ElectronicDocumentStatus) {
  const electronicDocumentService = {
    requireById: jest.fn().mockResolvedValue(buildDocumentStub(status)),
  };
  const siigoDocumentPreparationService = {
    prepareSupplierAndAccounts: jest.fn().mockResolvedValue({
      documentId: 'doc-1',
      nextStep: 'READY',
    }),
  };
  const siigoDocumentCreationService = {
    createInSiigo: jest.fn().mockResolvedValue(undefined),
  };
  const siigoAuthService = {
    getValidAuthContext: jest.fn().mockResolvedValue({}),
  };

  const service = new SiigoDocumentResumeService(
    electronicDocumentService as never,
    siigoDocumentPreparationService as never,
    siigoDocumentCreationService as never,
    siigoAuthService as never,
  );

  return {
    service,
    electronicDocumentService,
    siigoDocumentPreparationService,
    siigoDocumentCreationService,
    siigoAuthService,
  };
}

describe('SiigoDocumentResumeService.resume', () => {
  it('en modo prepareOnly (default), un documento PURCHASE_FAILED se reporta como FAILED sin volver a prepararlo (no limpia el error sin reintentar de verdad)', async () => {
    const {
      service,
      siigoDocumentPreparationService,
      siigoDocumentCreationService,
    } = buildService(ElectronicDocumentStatus.PURCHASE_FAILED);

    const response = await service.resume('doc-1', 'company-1');

    expect(response.nextStep).toBe('FAILED');
    expect(
      siigoDocumentPreparationService.prepareSupplierAndAccounts,
    ).not.toHaveBeenCalled();
    expect(siigoDocumentCreationService.createInSiigo).not.toHaveBeenCalled();
  });

  it('con prepareOnly=false explícito, sí vuelve a preparar un documento PURCHASE_FAILED (reintento real)', async () => {
    const { service, siigoDocumentPreparationService } = buildService(
      ElectronicDocumentStatus.PURCHASE_FAILED,
    );

    await service.resume('doc-1', 'company-1', undefined, {
      prepareOnly: false,
    });

    expect(
      siigoDocumentPreparationService.prepareSupplierAndAccounts,
    ).toHaveBeenCalledTimes(1);
  });

  it('un documento PURCHASE_CREATED se reporta como COMPLETED sin tocar nada', async () => {
    const { service, siigoDocumentPreparationService } = buildService(
      ElectronicDocumentStatus.PURCHASE_CREATED,
    );

    const response = await service.resume('doc-1', 'company-1');

    expect(response.nextStep).toBe('COMPLETED');
    expect(
      siigoDocumentPreparationService.prepareSupplierAndAccounts,
    ).not.toHaveBeenCalled();
  });
});

describe('SiigoDocumentResumeService.resumeBatch', () => {
  it('nunca reanuda más documentos en simultáneo que el límite de concurrencia acotada (bug real: 50 resume() disparados a la vez saturaban el rate limit de SIIGO)', async () => {
    const { service, siigoDocumentPreparationService } = buildService(
      ElectronicDocumentStatus.ACCOUNT_MAPPED,
    );

    let inFlight = 0;
    let maxInFlight = 0;

    siigoDocumentPreparationService.prepareSupplierAndAccounts.mockImplementation(
      async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;

        return { documentId: 'doc-1', nextStep: 'READY' };
      },
    );

    const documentIds = Array.from({ length: 23 }, (_, i) => `doc-${i}`);
    await service.resumeBatch(documentIds, 'company-1');

    expect(
      siigoDocumentPreparationService.prepareSupplierAndAccounts,
    ).toHaveBeenCalledTimes(23);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
