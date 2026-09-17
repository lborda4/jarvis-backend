import { SiigoPurchaseAiClassificationService } from './siigo-purchase-ai-classification.service';

function buildService(overrides: {
  classification: {
    itemType: 'Account' | 'Product' | null;
    accountCode: string | null;
    accountName: string | null;
    productCode: string | null;
    productName: string | null;
    confidence: number | null;
  };
}) {
  const document = {
    id: 'doc-1',
    companyId: 'company-1',
    payload: {
      supplier: { name: 'Proveedor SAS', documentNumber: '900123456' },
      items: [{ descripcion: 'Ítem nuevo sin regla previa' }],
    },
  };

  const electronicDocumentService = {
    requireById: jest.fn().mockResolvedValue(document),
    updatePayload: jest.fn().mockResolvedValue(undefined),
  };
  const supplierConfigurationsRepository = {
    findByCompanyIntegrationAndNormalizedSupplierDocument: jest
      .fn()
      .mockResolvedValue(null),
  };
  const supplierItemAccountMappingsRepository = {
    findOneByKey: jest.fn().mockResolvedValue(null),
  };
  const integrationsRepository = {
    findByCompanyAndProvider: jest
      .fn()
      .mockResolvedValue({ id: 'integration-1' }),
  };
  const openRouterHttpClient = {
    isConfigured: jest.fn().mockReturnValue(true),
  };
  const siigoAiAccountSuggestionService = {
    classifyItemTypeAndAccount: jest
      .fn()
      .mockResolvedValue(overrides.classification),
  };

  const service = new SiigoPurchaseAiClassificationService(
    electronicDocumentService as any,
    supplierConfigurationsRepository as any,
    supplierItemAccountMappingsRepository as any,
    integrationsRepository as any,
    openRouterHttpClient as any,
    siigoAiAccountSuggestionService as any,
  );

  return { service, electronicDocumentService };
}

describe('SiigoPurchaseAiClassificationService — la sugerencia vacía debe forzar "Requiere revisión"', () => {
  it('cuando la IA no encuentra ni cuenta ni producto, igual guarda aiSuggestion con confidence=0 (en vez de dejar el documento sin sugerencia)', async () => {
    const { service, electronicDocumentService } = buildService({
      classification: {
        itemType: 'Account',
        accountCode: null,
        accountName: null,
        productCode: null,
        productName: null,
        confidence: null,
      },
    });

    await service.classifyDocuments(['doc-1'], 'company-1');

    expect(electronicDocumentService.updatePayload).toHaveBeenCalledTimes(1);
    const [, payload] = electronicDocumentService.updatePayload.mock
      .calls[0] as [string, { aiSuggestion: unknown }, string];
    expect(payload.aiSuggestion).toEqual({
      account: null,
      product: null,
      retentions: [],
      confidence: 0,
    });
  });

  it('cuando la IA sí encuentra una cuenta, guarda su confidence real (no se fuerza a 0)', async () => {
    const { service, electronicDocumentService } = buildService({
      classification: {
        itemType: 'Account',
        accountCode: '5135',
        accountName: 'Gastos diversos',
        productCode: null,
        productName: null,
        confidence: 65,
      },
    });

    await service.classifyDocuments(['doc-1'], 'company-1');

    const [, payload] = electronicDocumentService.updatePayload.mock
      .calls[0] as [string, { aiSuggestion: unknown }, string];
    expect(payload.aiSuggestion).toEqual({
      account: { code: '5135', name: 'Gastos diversos' },
      product: null,
      retentions: [],
      confidence: 65,
    });
  });
});
