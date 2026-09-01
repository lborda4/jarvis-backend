import { BadRequestException } from '@nestjs/common';
import { ElectronicDocumentService } from './electronic-document.service';
import { ElectronicDocumentStatus } from './enums/electronic-document-status.enum';

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
  );

  return { service, electronicDocumentsRepository };
}

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
