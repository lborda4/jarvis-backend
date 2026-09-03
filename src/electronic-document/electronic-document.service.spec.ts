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
  );

  return { service, electronicDocumentsRepository };
}

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
