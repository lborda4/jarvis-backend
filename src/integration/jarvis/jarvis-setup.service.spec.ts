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
    listResolutions:
      overrides.listResolutions ?? jest.fn().mockResolvedValue([]),
  };

  const service = new JarvisSetupService(
    integrationsRepository as any,
    {} as any, // planSubscriptionService
    nextPymeApiClient as any,
    nextPymeMasterCatalogService as any,
  );

  return { service, integrationsRepository, nextPymeApiClient };
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
    );
  });

  it('cae al id fijo de factura electrónica cuando no manda typeDocumentId', async () => {
    const putConfigResolution = jest.fn().mockResolvedValue({});
    const { service } = buildService({ putConfigResolution });

    await service.saveResolution(buildRequest(), 'company-1');

    expect(putConfigResolution).toHaveBeenCalledWith(
      expect.objectContaining({ type_document_id: 1 }),
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
  });
});
