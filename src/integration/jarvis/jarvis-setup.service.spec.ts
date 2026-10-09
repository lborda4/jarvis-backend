import { JarvisSetupService } from './jarvis-setup.service';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import { SaveJarvisResolutionRequestDto } from './dto/jarvis-resolution.dto';

function buildService(overrides: {
  findByCompanyAndProvider?: jest.Mock;
  putConfigResolution?: jest.Mock;
  listResolutions?: jest.Mock;
}) {
  const integrationsRepository = {
    findByCompanyAndProvider:
      overrides.findByCompanyAndProvider ??
      jest.fn().mockResolvedValue({
        id: 'integration-1',
        credentials: {
          business_name: 'Empresa SAS',
          trade_name: 'Empresa',
          tax_regime: 'common',
          vat_regime: 'vat_responsible',
          tax_responsibility: 'R-99-PN',
          economic_activity: '1234',
          country: 'CO',
          department: 'Antioquia',
          municipality: 'Medellín',
          city: 'Medellín',
          email: 'a@a.com',
          address: 'Calle 1',
          phone: '3000000000',
          configured_at: new Date().toISOString(),
        },
      }),
    save: jest.fn().mockImplementation((integration) => integration),
  };
  const nextPymeApiClient = {
    putConfigResolution:
      overrides.putConfigResolution ?? jest.fn().mockResolvedValue({}),
  };
  const nextPymeMasterCatalogService = {
    getSupportDocumentTypeId: jest.fn().mockReturnValue(11),
    getElectronicInvoiceTypeId: jest.fn().mockReturnValue(1),
    invalidateResolutionsCache: jest.fn(),
    requireCompanyToken: jest.fn().mockResolvedValue("company-token"),
    listResolutions:
      overrides.listResolutions ?? jest.fn().mockResolvedValue([]),
  };

  const service = new JarvisSetupService(
    integrationsRepository as any,
    {} as any, // planSubscriptionService
    nextPymeApiClient as any,
    nextPymeMasterCatalogService as any,
  );

  return { service, integrationsRepository, nextPymeApiClient, nextPymeMasterCatalogService };
}

function buildRequest(
  overrides: Partial<SaveJarvisResolutionRequestDto> = {},
): SaveJarvisResolutionRequestDto {
  return {
    kind: JarvisResolutionKind.ELECTRONIC_INVOICE,
    formNumber: '18760000001',
    documentTypeLabel: 'FACTURA ELECTRÓNICA DE VENTA',
    prefix: 'FE',
    fromNumber: 1,
    toNumber: 10000,
    technicalKey: 'clave-tecnica-123',
    dateFrom: '2026-01-01',
    dateTo: '2027-01-01',
    ...overrides,
  } as SaveJarvisResolutionRequestDto;
}

describe('JarvisSetupService.saveResolution — type_document_id', () => {
  it('usa el typeDocumentId real que trajo el frontend en vez del id fijo por kind (bug real reportado: NextPyme rechazaba la clave técnica porque el id fijo no coincidía con el registrado para esa resolución)', async () => {
    const putConfigResolution = jest.fn().mockResolvedValue({});
    const { service } = buildService({ putConfigResolution });

    await service.saveResolution(
      buildRequest({ typeDocumentId: 42 }),
      'company-1',
    );

    expect(putConfigResolution).toHaveBeenCalledWith(
      expect.objectContaining({ type_document_id: 42 }),
      "company-token",
    );
  });

  it('cae al id fijo por kind cuando el frontend no manda typeDocumentId (compatibilidad con el flujo viejo de cargar el PDF)', async () => {
    const putConfigResolution = jest.fn().mockResolvedValue({});
    const { service } = buildService({ putConfigResolution });

    await service.saveResolution(
      buildRequest({ kind: JarvisResolutionKind.SUPPORT_DOCUMENT, technicalKey: undefined }),
      'company-1',
    );

    expect(putConfigResolution).toHaveBeenCalledWith(
      expect.objectContaining({ type_document_id: 11 }),
      "company-token",
    );
    expect(putConfigResolution.mock.calls[0][0]).not.toHaveProperty(
      'technical_key',
    );
  });

  it('no manda technical_key al guardar documento soporte aunque el frontend filtre una clave de factura (SETP/SEDS comparten resolución)', async () => {
    const putConfigResolution = jest.fn().mockResolvedValue({});
    const { service } = buildService({ putConfigResolution });

    await service.saveResolution(
      buildRequest({
        kind: JarvisResolutionKind.SUPPORT_DOCUMENT,
        prefix: 'SEDS',
        technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
        documentTypeLabel: 'DOCUMENTO SOPORTE',
      }),
      'company-1',
    );

    expect(putConfigResolution.mock.calls[0][0]).not.toHaveProperty(
      'technical_key',
    );
    expect(putConfigResolution).toHaveBeenCalledWith(
      expect.objectContaining({ type_document_id: 11, prefix: 'SEDS' }),
      'company-token',
    );
  });

  it('usa credentials.technical_key de la empresa en el PUT de factura (mismo campo del curl NextPyme)', async () => {
    const putConfigResolution = jest.fn().mockResolvedValue({});
    const findByCompanyAndProvider = jest.fn().mockImplementation(
      async (_companyId: string, provider: string) => {
        if (provider !== 'JARVIS') {
          return null;
        }
        return {
          id: 'integration-1',
          credentials: {
            business_name: 'Empresa SAS',
            trade_name: 'Empresa',
            tax_regime: 'common',
            vat_regime: 'vat_responsible',
            tax_responsibility: 'R-99-PN',
            economic_activity: '1234',
            country: 'CO',
            department: 'Antioquia',
            municipality: 'Medellín',
            city: 'Medellín',
            email: 'a@a.com',
            address: 'Calle 1',
            phone: '3000000000',
            configured_at: new Date().toISOString(),
            technical_key:
              'a2e4cf48298098fdd401d2e03b14ae13a048c58b6e6b2d122b39aca2a0250c1a',
          },
        };
      },
    );
    const { service } = buildService({
      putConfigResolution,
      findByCompanyAndProvider,
    });

    await service.saveResolution(
      buildRequest({
        prefix: 'FVJ',
        formNumber: '18764113677438',
        technicalKey: 'clave-del-rango-dian',
        dateFrom: '2026-08-05',
        dateTo: '2028-08-05',
        authorizedAt: '2026-08-05',
        fromNumber: 1,
        toNumber: 10000,
      }),
      'company-1',
    );

    expect(putConfigResolution).toHaveBeenCalledWith(
      {
        type_document_id: 1,
        prefix: 'FVJ',
        resolution: '18764113677438',
        resolution_date: '2026-08-05',
        technical_key:
          'a2e4cf48298098fdd401d2e03b14ae13a048c58b6e6b2d122b39aca2a0250c1a',
        from: 1,
        to: 10000,
        generated_to_date: 0,
        date_from: '2026-08-05',
        date_to: '2028-08-05',
      },
      'company-token',
    );
  });

  it('cae al id fijo de factura electrónica cuando no manda typeDocumentId', async () => {
    const putConfigResolution = jest.fn().mockResolvedValue({});
    const { service } = buildService({ putConfigResolution });

    await service.saveResolution(buildRequest(), 'company-1');

    expect(putConfigResolution).toHaveBeenCalledWith(
      expect.objectContaining({ type_document_id: 1 }),
      "company-token",
    );
  });

  it('guarda support_document sin borrar la resolución de factura ya persistida', async () => {
    const findByCompanyAndProvider = jest.fn().mockResolvedValue({
      id: 'integration-1',
      credentials: {
        business_name: 'Empresa SAS',
        trade_name: 'Empresa',
        tax_regime: 'common',
        vat_regime: 'vat_responsible',
        tax_responsibility: 'R-99-PN',
        economic_activity: '1234',
        country: 'CO',
        department: 'Antioquia',
        municipality: 'Medellín',
        city: 'Medellín',
        email: 'a@a.com',
        address: 'Calle 1',
        phone: '3000000000',
        configured_at: new Date().toISOString(),
        resolutions: {
          electronic_invoice: {
            kind: JarvisResolutionKind.ELECTRONIC_INVOICE,
            prefix: 'SETP',
            formNumber: '18760000001',
            documentTypeLabel: 'Factura electrónica de Venta',
            fromNumber: 990000000,
            toNumber: 995000000,
            nextConsecutive: 990000008,
            technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
            dateFrom: '2019-01-19',
            dateTo: '2030-01-19',
          },
        },
      },
    });
    const { service, integrationsRepository } = buildService({
      findByCompanyAndProvider,
    });

    await service.saveResolution(
      buildRequest({
        kind: JarvisResolutionKind.SUPPORT_DOCUMENT,
        prefix: 'SEDS',
        fromNumber: 984000000,
        toNumber: 985000000,
        technicalKey: undefined,
        documentTypeLabel: 'DOCUMENTO SOPORTE',
        dateFrom: '2019-01-19',
        dateTo: '2030-06-30',
      }),
      'company-1',
    );

    const saved = integrationsRepository.save.mock.calls.at(-1)![0];
    expect(saved.credentials.resolutions.electronic_invoice.prefix).toBe('SETP');
    expect(saved.credentials.resolutions.support_document).toEqual(
      expect.objectContaining({
        kind: JarvisResolutionKind.SUPPORT_DOCUMENT,
        prefix: 'SEDS',
        formNumber: '18760000001',
        fromNumber: 984000000,
        toNumber: 985000000,
        nextConsecutive: 984000000,
      }),
    );
  });

  it('typeDocumentId=0 (NEXTPYME_UNKNOWN_TYPE_DOCUMENT_ID) no se manda tal cual — cae al id fijo por kind (bug real reportado: NextPyme seguía rechazando la clave técnica porque 0 tampoco es "factura electrónica" para su catálogo)', async () => {
    const putConfigResolution = jest.fn().mockResolvedValue({});
    const { service } = buildService({ putConfigResolution });

    await service.saveResolution(
      buildRequest({ typeDocumentId: 0 }),
      'company-1',
    );

    expect(putConfigResolution).toHaveBeenCalledWith(
      expect.objectContaining({ type_document_id: 1 }),
      "company-token",
    );
  });
});

describe('JarvisSetupService.listAvailableResolutions — normalización de typeDocumentId', () => {
  it('normaliza type_document_id=0 (NEXTPYME_UNKNOWN_TYPE_DOCUMENT_ID, sentinel del parseo del sobre DIAN) a null en vez de reportarlo como si fuera un id real', async () => {
    const { service } = buildService({
      listResolutions: jest.fn().mockResolvedValue([
        {
          type_document_id: 0,
          prefix: 'FE',
          number: 1,
          from: 1,
          to: 10000,
        },
      ]),
    });

    const result = await service.listAvailableResolutions();

    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0].typeDocumentId).toBeNull();
    expect(result.resolutions[0].kind).toBeNull();
  });

  it('conserva un type_document_id real distinto de 0', async () => {
    const { service } = buildService({
      listResolutions: jest.fn().mockResolvedValue([
        {
          type_document_id: 1,
          prefix: 'FE',
          number: 1,
          from: 1,
          to: 10000,
        },
      ]),
    });

    const result = await service.listAvailableResolutions();

    expect(result.resolutions[0].typeDocumentId).toBe(1);
    expect(result.resolutions[0].kind).toBe(
      JarvisResolutionKind.ELECTRONIC_INVOICE,
    );
  });

  it('separa factura (1) y documento soporte (11) para los selectores de Configuración', async () => {
    const { service } = buildService({
      listResolutions: jest.fn().mockResolvedValue([
        {
          type_document_id: 1,
          prefix: 'FVJ',
          resolution: '18764113677438',
          number: 1,
          from: 1,
          to: 10000,
          date_from: '2026-08-05',
          date_to: '2028-08-05',
        },
        {
          type_document_id: 11,
          prefix: 'DSJ',
          resolution: '13028144278805',
          number: 1,
          from: 1,
          to: 10000,
          date_from: '2026-08-05',
          date_to: '2027-08-05',
        },
      ]),
    });

    const result = await service.listAvailableResolutions();

    expect(result.resolutions).toEqual([
      expect.objectContaining({
        prefix: 'FVJ',
        kind: JarvisResolutionKind.ELECTRONIC_INVOICE,
        typeDocumentId: 1,
      }),
      expect.objectContaining({
        prefix: 'DSJ',
        kind: JarvisResolutionKind.SUPPORT_DOCUMENT,
        typeDocumentId: 11,
      }),
    ]);
  });
});

describe('Numeracion independiente de notas credito', () => {
  it('avanza a 2 después de un envío aceptado aunque no hubiera numeración previa', async () => {
    const { service, integrationsRepository } = buildService({});

    await service.commitResolutionNumber(
      'company-1',
      JarvisResolutionKind.CREDIT_NOTE,
      1,
    );

    const saved = integrationsRepository.save.mock.calls.at(-1)![0];
    expect(saved.credentials.resolutions.credit_note.nextConsecutive).toBe(2);
    expect(saved.credentials.resolutions.credit_note.prefix).toBe('NC');
  });

  it('asigna NC desde 1 sin que el cliente configure la numeración', async () => {
    const { service, integrationsRepository } = buildService({});

    await expect(
      service.allocateResolutionNumber(
        'company-1',
        JarvisResolutionKind.CREDIT_NOTE,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ prefix: 'NC', number: 1, formNumber: null }),
    );

    const saved = integrationsRepository.save.mock.calls[0][0];
    expect(saved.credentials.resolutions.credit_note).toEqual(
      expect.objectContaining({ prefix: 'NC', nextConsecutive: 1 }),
    );
  });

  it('guarda NC sin clave tecnica y conserva factura y soporte al avanzar', async () => {
    const {service, integrationsRepository, nextPymeApiClient} = buildService({});
    const saved = await service.saveResolution(buildRequest({ kind: JarvisResolutionKind.CREDIT_NOTE, prefix: 'NC', technicalKey: undefined }), 'company-1');
    expect(nextPymeApiClient.putConfigResolution).toHaveBeenCalledWith(expect.objectContaining({ type_document_id: 4 }), "company-token");
    expect(nextPymeApiClient.putConfigResolution.mock.calls[0][0]).not.toHaveProperty(
      'technical_key',
    );
    const integration = integrationsRepository.save.mock.calls[0][0];
    const invoice = { ...saved.resolution, kind: JarvisResolutionKind.ELECTRONIC_INVOICE, prefix: 'FV', nextConsecutive: 50 };
    integration.credentials.resolutions.electronic_invoice = invoice;
    integrationsRepository.findByCompanyAndProvider.mockResolvedValue(integration);
    expect(await service.allocateResolutionNumber('company-1', JarvisResolutionKind.CREDIT_NOTE)).toEqual(expect.objectContaining({ prefix: 'NC', number: 1 }));
    await service.commitResolutionNumber('company-1', JarvisResolutionKind.CREDIT_NOTE, 1);
    const updated = integrationsRepository.save.mock.calls.at(-1)![0].credentials.resolutions;
    expect(updated.credit_note.nextConsecutive).toBe(2);
    expect(updated.electronic_invoice.nextConsecutive).toBe(50);
  });
});

describe('Numeracion independiente de notas de ajuste', () => {
  it('asigna NDS desde 1 sin que el cliente configure la numeración', async () => {
    const { service, integrationsRepository } = buildService({});

    await expect(
      service.allocateResolutionNumber(
        'company-1',
        JarvisResolutionKind.SUPPORT_CREDIT_NOTE,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ prefix: 'NDS', number: 1, formNumber: null }),
    );

    const saved = integrationsRepository.save.mock.calls[0][0];
    expect(saved.credentials.resolutions.support_credit_note).toEqual(
      expect.objectContaining({ prefix: 'NDS', nextConsecutive: 1 }),
    );
  });

  it('avanza a 2 después de un envío aceptado aunque no hubiera numeración previa', async () => {
    const { service, integrationsRepository } = buildService({});

    await service.commitResolutionNumber(
      'company-1',
      JarvisResolutionKind.SUPPORT_CREDIT_NOTE,
      1,
    );

    const saved = integrationsRepository.save.mock.calls.at(-1)![0];
    expect(saved.credentials.resolutions.support_credit_note.nextConsecutive).toBe(2);
    expect(saved.credentials.resolutions.support_credit_note.prefix).toBe('NDS');
  });
});

describe('Numeracion independiente de notas debito', () => {
  it('avanza a 2 después de un envío aceptado aunque no hubiera numeración previa', async () => {
    const { service, integrationsRepository } = buildService({});

    await service.commitResolutionNumber(
      'company-1',
      JarvisResolutionKind.DEBIT_NOTE,
      1,
    );

    const saved = integrationsRepository.save.mock.calls.at(-1)![0];
    expect(saved.credentials.resolutions.debit_note.nextConsecutive).toBe(2);
    expect(saved.credentials.resolutions.debit_note.prefix).toBe('ND');
  });

  it('asigna ND desde 1 sin que el cliente configure la numeración', async () => {
    const { service, integrationsRepository } = buildService({});

    await expect(
      service.allocateResolutionNumber(
        'company-1',
        JarvisResolutionKind.DEBIT_NOTE,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ prefix: 'ND', number: 1, formNumber: null }),
    );

    const saved = integrationsRepository.save.mock.calls[0][0];
    expect(saved.credentials.resolutions.debit_note).toEqual(
      expect.objectContaining({ prefix: 'ND', nextConsecutive: 1 }),
    );
  });

  it('guarda ND sin clave tecnica y conserva factura y soporte al avanzar', async () => {
    const {service, integrationsRepository, nextPymeApiClient} = buildService({});
    const saved = await service.saveResolution(buildRequest({ kind: JarvisResolutionKind.DEBIT_NOTE, prefix: 'ND', technicalKey: undefined }), 'company-1');
    expect(nextPymeApiClient.putConfigResolution).toHaveBeenCalledWith(expect.objectContaining({ type_document_id: 5 }), "company-token");
    expect(nextPymeApiClient.putConfigResolution.mock.calls[0][0]).not.toHaveProperty(
      'technical_key',
    );
    const integration = integrationsRepository.save.mock.calls[0][0];
    const invoice = { ...saved.resolution, kind: JarvisResolutionKind.ELECTRONIC_INVOICE, prefix: 'FV', nextConsecutive: 50 };
    integration.credentials.resolutions.electronic_invoice = invoice;
    integrationsRepository.findByCompanyAndProvider.mockResolvedValue(integration);
    expect(await service.allocateResolutionNumber('company-1', JarvisResolutionKind.DEBIT_NOTE)).toEqual(expect.objectContaining({ prefix: 'ND', number: 1 }));
    await service.commitResolutionNumber('company-1', JarvisResolutionKind.DEBIT_NOTE, 1);
    const updated = integrationsRepository.save.mock.calls.at(-1)![0].credentials.resolutions;
    expect(updated.debit_note.nextConsecutive).toBe(2);
    expect(updated.electronic_invoice.nextConsecutive).toBe(50);
  });
});

describe('JarvisSetupService.allocateResolutionNumber — DS', () => {
  it('asigna el consecutivo local y no consulta ni restringe vigencia antes de emitir', async () => {
    const putConfigResolution = jest.fn();
    const listResolutions = jest.fn();
    const { service, integrationsRepository } = buildService({
      putConfigResolution,
      listResolutions,
    });

    integrationsRepository.findByCompanyAndProvider.mockResolvedValue({
      id: 'integration-1',
      credentials: {
        business_name: 'Empresa SAS',
        economic_activity: '1234',
        tax_regime: 'common',
        vat_regime: 'vat_responsible',
        tax_responsibility: 'R-99-PN',
        country: 'CO',
        department: 'Antioquia',
        municipality: 'Medellín',
        city: 'Medellín',
        email: 'a@a.com',
        address: 'Calle 1',
        phone: '3000000000',
        configured_at: new Date().toISOString(),
        resolutions: {
          support_document: {
            kind: JarvisResolutionKind.SUPPORT_DOCUMENT,
            prefix: 'DSJ',
            formNumber: '13028144278805',
            documentTypeLabel: 'DOCUMENTO SOPORTE',
            fromNumber: 1,
            toNumber: 10000,
            nextConsecutive: 1,
            dateFrom: '2026-08-05',
            dateTo: '2027-08-05',
          },
        },
      },
    });

    await expect(
      service.allocateResolutionNumber(
        'company-1',
        JarvisResolutionKind.SUPPORT_DOCUMENT,
      ),
    ).resolves.toEqual({
      prefix: 'DSJ',
      number: 1,
      toNumber: 10000,
      formNumber: '13028144278805',
    });
    expect(listResolutions).not.toHaveBeenCalled();
    expect(putConfigResolution).not.toHaveBeenCalled();
  });
});
