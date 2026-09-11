import { JarvisTercerosService } from './jarvis-terceros.service';
import { JarvisDocumentType } from './enums/jarvis-document-type.enum';

function buildService(overrides: {
  findPendingJarvisSuppliers?: jest.Mock;
  lookupDocument?: jest.Mock;
  findByCompanyAndDocument?: jest.Mock;
  save?: jest.Mock;
  create?: jest.Mock;
  prepareDocumentsInBackground?: jest.Mock;
}) {
  const integrationsRepository = {
    findByCompanyAndProvider: jest
      .fn()
      .mockResolvedValue({ id: 'integration-1', credentials: null }),
  };
  const jarvisTercerosRepository = {
    findByCompanyAndDocument:
      overrides.findByCompanyAndDocument ?? jest.fn().mockResolvedValue(null),
    save: overrides.save ?? jest.fn().mockImplementation((entity) => entity),
    create:
      overrides.create ?? jest.fn().mockImplementation((entity) => entity),
  };
  const nextPymeRutService = {
    lookupDocument:
      overrides.lookupDocument ??
      jest.fn().mockResolvedValue({ found: false, document_number: '' }),
  };
  const electronicDocumentsRepository = {
    findPendingJarvisSuppliers:
      overrides.findPendingJarvisSuppliers ?? jest.fn().mockResolvedValue([]),
  };
  const jarvisDocumentPreparationService = {
    prepareDocumentsInBackground:
      overrides.prepareDocumentsInBackground ?? jest.fn(),
  };

  const service = new JarvisTercerosService(
    integrationsRepository as any,
    jarvisTercerosRepository as any,
    nextPymeRutService as any,
    electronicDocumentsRepository as any,
    jarvisDocumentPreparationService as any,
  );

  return {
    service,
    integrationsRepository,
    jarvisTercerosRepository,
    nextPymeRutService,
    electronicDocumentsRepository,
    jarvisDocumentPreparationService,
  };
}

describe('JarvisTercerosService.listPendingSuppliers', () => {
  it('enriquece cada proveedor pendiente con el nombre/correo de NextPyme cuando lo encuentra', async () => {
    const { service } = buildService({
      findPendingJarvisSuppliers: jest.fn().mockResolvedValue([
        {
          documentId: 'doc-1',
          documentNumberThird: '900123456',
          documentTypeThird: 'NIT',
          supplierName: 'Nombre del documento importado',
        },
      ]),
      lookupDocument: jest.fn().mockResolvedValue({
        found: true,
        document_number: '900123456',
        name: 'Nombre NextPyme SAS',
        email: 'contacto@nextpyme.com',
      }),
    });

    const result = await service.listPendingSuppliers('company-1');

    expect(result.items).toEqual([
      {
        document_id: 'doc-1',
        document_type: JarvisDocumentType.NIT,
        document_number: '900123456',
        name: 'Nombre NextPyme SAS',
        email: 'contacto@nextpyme.com',
      },
    ]);
  });

  it('si NextPyme no encuentra nada, conserva el nombre que ya traía el documento importado y deja el correo vacío', async () => {
    const { service } = buildService({
      findPendingJarvisSuppliers: jest.fn().mockResolvedValue([
        {
          documentId: 'doc-1',
          documentNumberThird: '900123456',
          documentTypeThird: 'NIT',
          supplierName: 'Nombre del documento importado',
        },
      ]),
      lookupDocument: jest.fn().mockResolvedValue({
        found: false,
        document_number: '900123456',
      }),
    });

    const result = await service.listPendingSuppliers('company-1');

    expect(result.items).toEqual([
      {
        document_id: 'doc-1',
        document_type: JarvisDocumentType.NIT,
        document_number: '900123456',
        name: 'Nombre del documento importado',
        email: null,
      },
    ]);
  });

  it('un fallo de NextPyme en un proveedor puntual no tumba el resto del listado', async () => {
    const lookupDocument = jest
      .fn()
      .mockRejectedValueOnce(new Error('NextPyme caído'))
      .mockResolvedValueOnce({
        found: true,
        document_number: '900654321',
        name: 'Proveedor 2 SAS',
        email: 'p2@correo.com',
      });

    const { service } = buildService({
      findPendingJarvisSuppliers: jest.fn().mockResolvedValue([
        {
          documentId: 'doc-1',
          documentNumberThird: '900123456',
          documentTypeThird: 'NIT',
          supplierName: 'Proveedor 1 (del documento)',
        },
        {
          documentId: 'doc-2',
          documentNumberThird: '900654321',
          documentTypeThird: 'NIT',
          supplierName: 'Proveedor 2 (del documento)',
        },
      ]),
      lookupDocument,
    });

    const result = await service.listPendingSuppliers('company-1');

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      document_id: 'doc-1',
      document_type: JarvisDocumentType.NIT,
      document_number: '900123456',
      name: 'Proveedor 1 (del documento)',
      email: null,
    });
    expect(result.items[1]).toEqual({
      document_id: 'doc-2',
      document_type: JarvisDocumentType.NIT,
      document_number: '900654321',
      name: 'Proveedor 2 SAS',
      email: 'p2@correo.com',
    });
  });
});

describe('JarvisTercerosService.createBulk', () => {
  it('crea los proveedores nuevos y reanuda la preparación de su documento pendiente', async () => {
    const save = jest.fn().mockImplementation((entity) => entity);
    const prepareDocumentsInBackground = jest.fn();

    const { service, jarvisTercerosRepository } = buildService({
      findByCompanyAndDocument: jest.fn().mockResolvedValue(null),
      save,
      prepareDocumentsInBackground,
    });

    const result = await service.createBulk(
      {
        suppliers: [
          {
            document_id: 'doc-1',
            document_type: JarvisDocumentType.NIT,
            document_number: '900123456',
            name: 'Proveedor 1 SAS',
            email: 'p1@correo.com',
          },
        ],
      },
      'company-1',
    );

    expect(result).toEqual({ created: 1, skipped: 0 });
    expect(jarvisTercerosRepository.save).toHaveBeenCalledTimes(1);
    expect(prepareDocumentsInBackground).toHaveBeenCalledWith(
      ['doc-1'],
      'company-1',
    );
  });

  it('un proveedor que ya tiene tercero se cuenta como "skipped" en vez de romper el lote — y su documento igual se reanuda', async () => {
    const findByCompanyAndDocument = jest
      .fn()
      .mockResolvedValueOnce({ id: 'existing-tercero' })
      .mockResolvedValueOnce(null);
    const save = jest.fn().mockImplementation((entity) => entity);
    const prepareDocumentsInBackground = jest.fn();

    const { service } = buildService({
      findByCompanyAndDocument,
      save,
      prepareDocumentsInBackground,
    });

    const result = await service.createBulk(
      {
        suppliers: [
          {
            document_id: 'doc-1',
            document_type: JarvisDocumentType.NIT,
            document_number: '900123456',
            name: 'Ya existe SAS',
          },
          {
            document_id: 'doc-2',
            document_type: JarvisDocumentType.NIT,
            document_number: '900654321',
            name: 'Nuevo proveedor SAS',
          },
        ],
      },
      'company-1',
    );

    expect(result).toEqual({ created: 1, skipped: 1 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(prepareDocumentsInBackground).toHaveBeenCalledWith(
      ['doc-1', 'doc-2'],
      'company-1',
    );
  });

  it('ignora filas sin número de documento o sin nombre en vez de fallar el lote entero', async () => {
    const save = jest.fn().mockImplementation((entity) => entity);
    const prepareDocumentsInBackground = jest.fn();

    const { service } = buildService({
      findByCompanyAndDocument: jest.fn().mockResolvedValue(null),
      save,
      prepareDocumentsInBackground,
    });

    const result = await service.createBulk(
      {
        suppliers: [
          {
            document_id: 'doc-1',
            document_type: JarvisDocumentType.NIT,
            document_number: '',
            name: 'Sin número',
          },
          {
            document_id: 'doc-2',
            document_type: JarvisDocumentType.NIT,
            document_number: '900123456',
            name: '',
          },
        ],
      },
      'company-1',
    );

    expect(result).toEqual({ created: 0, skipped: 0 });
    expect(save).not.toHaveBeenCalled();
    expect(prepareDocumentsInBackground).not.toHaveBeenCalled();
  });

  it('no reanuda nada si el lote llega vacío', async () => {
    const { service, jarvisDocumentPreparationService } = buildService({});

    const result = await service.createBulk(
      { suppliers: [] },
      'company-1',
    );

    expect(result).toEqual({ created: 0, skipped: 0 });
    expect(
      jarvisDocumentPreparationService.prepareDocumentsInBackground,
    ).not.toHaveBeenCalled();
  });
});
