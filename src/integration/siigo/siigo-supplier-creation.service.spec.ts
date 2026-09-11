import { SiigoSupplierCreationService } from './siigo-supplier-creation.service';
import { JarvisDocumentType } from '../jarvis/enums/jarvis-document-type.enum';

function buildService(overrides: {
  findByCompanyAndProvider?: jest.Mock;
  findPendingSupplierCandidates?: jest.Mock;
  findCompanyById?: jest.Mock;
  lookupDocument?: jest.Mock;
}) {
  const integrationsRepository = {
    findByCompanyAndProvider:
      overrides.findByCompanyAndProvider ??
      jest.fn().mockResolvedValue({ id: 'integration-1' }),
  };
  const electronicDocumentsRepository = {
    findPendingSupplierCandidates:
      overrides.findPendingSupplierCandidates ??
      jest.fn().mockResolvedValue([]),
  };
  const companiesRepository = {
    findById:
      overrides.findCompanyById ??
      jest.fn().mockResolvedValue({ nextPymeToken: null }),
  };
  const nextPymeRutService = {
    lookupDocument:
      overrides.lookupDocument ??
      jest.fn().mockResolvedValue({ found: false, document_number: '' }),
  };

  const service = new SiigoSupplierCreationService(
    {} as any, // siigoAuthService
    {} as any, // siigoSupplierService
    integrationsRepository as any,
    {} as any, // supplierConfigurationsRepository
    {} as any, // electronicDocumentService
    electronicDocumentsRepository as any,
    companiesRepository as any,
    nextPymeRutService as any,
  );

  return { service, integrationsRepository, electronicDocumentsRepository };
}

describe('SiigoSupplierCreationService.listPendingSuppliers', () => {
  it('enriquece cada proveedor pendiente con RUT/RUES de NextPyme cuando lo encuentra', async () => {
    const { service } = buildService({
      findPendingSupplierCandidates: jest.fn().mockResolvedValue([
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
      findPendingSupplierCandidates: jest.fn().mockResolvedValue([
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
    expect(result.items[1].email).toBe('p2@correo.com');
  });

  it('lanza si la empresa no tiene integración SIIGO configurada', async () => {
    const { service } = buildService({
      findByCompanyAndProvider: jest.fn().mockResolvedValue(null),
    });

    await expect(service.listPendingSuppliers('company-1')).rejects.toThrow();
  });
});

describe('SiigoSupplierCreationService.createSuppliersBulk', () => {
  it('crea todos los seleccionados en paralelo y cuenta los éxitos', async () => {
    const { service } = buildService({});
    const createSupplier = jest
      .spyOn(service, 'createSupplier')
      .mockResolvedValue({ success: true, created: true } as any);

    const result = await service.createSuppliersBulk(
      ['doc-1', 'doc-2', 'doc-3'],
      'company-1',
    );

    expect(result).toEqual({
      created: 3,
      failed: 0,
      results: [
        { documentId: 'doc-1', success: true, errorMessage: null },
        { documentId: 'doc-2', success: true, errorMessage: null },
        { documentId: 'doc-3', success: true, errorMessage: null },
      ],
    });
    expect(createSupplier).toHaveBeenCalledTimes(3);
    expect(createSupplier).toHaveBeenCalledWith(
      { documentId: 'doc-1' },
      'company-1',
      'manual',
    );
  });

  it('el fallo de un documento no bloquea el resto del lote', async () => {
    const { service } = buildService({});
    jest
      .spyOn(service, 'createSupplier')
      .mockImplementationOnce(() => {
        throw new Error('SIIGO caído');
      })
      .mockResolvedValueOnce({ success: true, created: true } as any);

    const result = await service.createSuppliersBulk(
      ['doc-1', 'doc-2'],
      'company-1',
    );

    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results).toEqual([
      { documentId: 'doc-1', success: false, errorMessage: 'SIIGO caído' },
      { documentId: 'doc-2', success: true, errorMessage: null },
    ]);
  });

  it('descarta ids repetidos o vacíos antes de crear', async () => {
    const { service } = buildService({});
    const createSupplier = jest
      .spyOn(service, 'createSupplier')
      .mockResolvedValue({ success: true, created: true } as any);

    const result = await service.createSuppliersBulk(
      ['doc-1', 'doc-1', '  ', 'doc-2'],
      'company-1',
    );

    expect(createSupplier).toHaveBeenCalledTimes(2);
    expect(result.created).toBe(2);
  });
});
