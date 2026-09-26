import { BadGatewayException } from '@nestjs/common';
import { SiigoPurchaseAiClassificationService } from './siigo-purchase-ai-classification.service';

function buildService(overrides: {
  classification: {
    itemType: 'Account' | 'Product' | null;
    accountCode: string | null;
    accountName: string | null;
    productCode: string | null;
    productName: string | null;
    confidence: number | null;
    items?: Array<{
      accountCode: string | null;
      accountName: string | null;
      productCode: string | null;
      productName: string | null;
      confidence: number | null;
    }>;
  };
  configuration?: unknown;
  itemMapping?: { accountCode: string; accountName: string } | null;
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
      .mockResolvedValue(overrides.configuration ?? null),
  };
  const supplierItemAccountMappingsRepository = {
    findOneByKey: jest.fn().mockResolvedValue(overrides.itemMapping ?? null),
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

  return {
    service,
    electronicDocumentService,
    siigoAiAccountSuggestionService,
  };
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
      itemType: 'Account',
      account: null,
      product: null,
      retentions: [],
      confidence: 0,
    });
  });

  it('si hay cuenta pero el modelo no mandó confidence, igual guarda 0 para que dispare Requiere revisión', async () => {
    const { service, electronicDocumentService } = buildService({
      classification: {
        itemType: 'Account',
        accountCode: '5135',
        accountName: 'Gastos diversos',
        productCode: null,
        productName: null,
        confidence: null,
        items: [
          {
            accountCode: '5135',
            accountName: 'Gastos diversos',
            productCode: null,
            productName: null,
            confidence: null,
          },
        ],
      },
    });

    await service.classifyDocuments(['doc-1'], 'company-1');

    const [, payload] = electronicDocumentService.updatePayload.mock
      .calls[0] as [string, { aiSuggestion: { confidence: unknown } }, string];
    expect(payload.aiSuggestion.confidence).toBe(0);
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
      itemType: 'Account',
      account: { code: '5135', name: 'Gastos diversos' },
      product: null,
      retentions: [],
      confidence: 65,
    });
  });

  it('guarda Product y su código para que el frontend muestre el selector de producto', async () => {
    const { service, electronicDocumentService } = buildService({
      classification: {
        itemType: 'Product',
        accountCode: null,
        accountName: null,
        productCode: 'BOTATITAN235209042',
        productName: 'Bota Titán',
        confidence: 30,
      },
    });

    await service.classifyDocuments(['doc-1'], 'company-1');

    const [, payload] = electronicDocumentService.updatePayload.mock
      .calls[0] as [string, { aiSuggestion: unknown }, string];
    expect(payload.aiSuggestion).toEqual({
      itemType: 'Product',
      account: null,
      product: {
        code: 'BOTATITAN235209042',
        name: 'Bota Titán',
      },
      retentions: [],
      confidence: 30,
    });
  });

  it('llama a la IA cuando el tipo es Producto fijo pero no hay código de producto (cuentaPuc variable), aunque el medio de pago ya esté resuelto', async () => {
    const { service, siigoAiAccountSuggestionService } = buildService({
      classification: {
        itemType: 'Product',
        accountCode: null,
        accountName: null,
        productCode: 'SKU-ASEO-01',
        productName: 'Detergente',
        confidence: 70,
      },
      configuration: {
        campoVariabilidad: {
          tipoItem: { valor: 'Product', variable: false },
          cuentaPuc: { valor: null, variable: true },
          medioPago: {
            valor: {
              id: 5056,
              name: 'Crédito proveedores',
              type: 'Proveedor',
              dueDate: true,
            },
            variable: false,
          },
        },
      },
      itemMapping: {
        accountCode: '51050601',
        accountName: 'Elementos de aseo',
      },
    });

    await service.classifyDocuments(['doc-1'], 'company-1');

    expect(
      siigoAiAccountSuggestionService.classifyItemTypeAndAccount,
    ).toHaveBeenCalled();
  });

  it('escribe la cuenta de cada línea en payload.items[].accountMapping', async () => {
    const { service, electronicDocumentService } = buildService({
      classification: {
        itemType: 'Account',
        accountCode: null,
        accountName: null,
        productCode: null,
        productName: null,
        confidence: 70,
        items: [
          {
            accountCode: '51953001',
            accountName: 'Papelería',
            productCode: null,
            productName: null,
            confidence: 80,
          },
        ],
      },
    });

    await service.classifyDocuments(['doc-1'], 'company-1');

    const [, payload] = electronicDocumentService.updatePayload.mock
      .calls[0] as [
      string,
      { items: Array<{ accountMapping?: { code: string } }> },
      string,
    ];

    expect(payload.items[0].accountMapping).toEqual({
      code: '51953001',
      description: 'Papelería',
    });
  });

  it('llama a la IA cuando el tipo es Cuenta fijo pero no hay código de cuenta (cuentaPuc variable)', async () => {
    const { service, siigoAiAccountSuggestionService } = buildService({
      classification: {
        itemType: 'Account',
        accountCode: '51959501',
        accountName: 'Diversos',
        productCode: null,
        productName: null,
        confidence: 55,
      },
      configuration: {
        campoVariabilidad: {
          tipoItem: { valor: 'Account', variable: false },
          cuentaPuc: { valor: null, variable: true },
          medioPago: {
            valor: {
              id: 5056,
              name: 'Crédito proveedores',
              type: 'Proveedor',
              dueDate: true,
            },
            variable: false,
          },
        },
      },
    });

    await service.classifyDocuments(['doc-1'], 'company-1');

    expect(
      siigoAiAccountSuggestionService.classifyItemTypeAndAccount,
    ).toHaveBeenCalled();
  });
});

it('persists review status when the AI provider fails before resolving the type', async () => {
  const {
    service,
    electronicDocumentService,
    siigoAiAccountSuggestionService,
  } = buildService({
    classification: {
      itemType: null,
      accountCode: null,
      accountName: null,
      productCode: null,
      productName: null,
      confidence: null,
    },
  });
  siigoAiAccountSuggestionService.classifyItemTypeAndAccount.mockRejectedValue(
    new BadGatewayException(),
  );
  await service.classifyDocuments(['doc-1'], 'company-1');
  expect(electronicDocumentService.updatePayload).toHaveBeenCalledWith(
    'doc-1',
    expect.objectContaining({
      aiSuggestion: expect.objectContaining({
        confidence: 0,
        account: null,
        product: null,
      }),
    }),
    'company-1',
  );
});
