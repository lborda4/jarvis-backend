import {
  SiigoAiAccountSuggestionService,
  selectProductsForClassificationPrompt,
} from './siigo-ai-account-suggestion.service';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { HistorialFacturaFuente } from '../enums/historial-factura-fuente.enum';
import { HistorialFacturaTipo } from '../enums/historial-factura-tipo.enum';
import { ACCOUNT_CONFIDENCE } from './helpers/account-suggestion-confidence.helper';

function buildProduct(code: string, name: string) {
  return { code, name };
}

describe('selectProductsForClassificationPrompt', () => {
  it('deja pasar el catálogo intacto cuando está por debajo del límite', () => {
    const products = [
      buildProduct('P1', 'Producto uno'),
      buildProduct('P2', 'Producto dos'),
    ];

    expect(selectProductsForClassificationPrompt(['X'], products)).toEqual(
      products,
    );
  });

  it('caso real reportado: catálogo grande (textilera) sin ningún producto relacionado con snacks queda vacío, en vez de mandar "los primeros N" que no aportan nada', () => {
    const products = Array.from({ length: 200 }, (_, index) =>
      buildProduct(`TEL-${index}`, `Tela ripstop referencia ${index}`),
    );

    const selected = selectProductsForClassificationPrompt(
      ['PONY MALTA GO PET 20', 'GALLETA MUUU LECHE C'],
      products,
    );

    expect(selected).toEqual([]);
  });

  it('con catálogo grande, se queda solo con los productos que comparten alguna palabra con la descripción del ítem', () => {
    const products = [
      ...Array.from({ length: 200 }, (_, index) =>
        buildProduct(`TEL-${index}`, `Tela ripstop referencia ${index}`),
      ),
      buildProduct('GALLETA-001', 'Galleta de leche surtida'),
    ];

    const selected = selectProductsForClassificationPrompt(
      ['GALLETA MUUU LECHE C'],
      products,
    );

    expect(selected).toEqual([
      buildProduct('GALLETA-001', 'Galleta de leche surtida'),
    ]);
  });

  it('recorta a MAX_PRODUCTS_FOR_CLASSIFICATION_PROMPT aunque haya muchos matches', () => {
    const products = Array.from({ length: 200 }, (_, index) =>
      buildProduct(`GALLETA-${index}`, `Galleta surtida ${index}`),
    );

    const selected = selectProductsForClassificationPrompt(
      ['GALLETA MUUU LECHE C'],
      products,
    );

    expect(selected.length).toBe(80);
  });

  it('ignora palabras de menos de 4 letras al buscar coincidencias (poco discriminantes)', () => {
    const products = Array.from({ length: 200 }, (_, index) =>
      buildProduct(`X-${index}`, `Producto de tela sin relación ${index}`),
    );

    // "de" (2 letras) no debería matchear con "Producto de tela..." en todos.
    const selected = selectProductsForClassificationPrompt(['de'], products);

    expect(selected).toEqual([]);
  });
});

describe('SiigoAiAccountSuggestionService.classifyItemTypeAndAccount — Documento soporte nunca clasifica como Producto', () => {
  function buildService(document: any) {
    const openRouterHttpClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      // Paso 1 (tipo, sin catálogos) y paso 2 (código, un catálogo) son dos
      // llamadas separadas ahora — esta respuesta sirve para cualquiera de
      // las dos: trae itemType (paso 1) Y accountCode (paso 2), ninguna de
      // las dos lee campos que no le interesan.
      createChatCompletion: jest.fn().mockResolvedValue({
        content: '{"itemType":"Account","accountCode":"5135","confidence":80}',
      }),
    };
    const electronicDocumentService = {
      requireById: jest.fn().mockResolvedValue(document),
    };
    const siigoProductsCatalogService = {
      listProducts: jest
        .fn()
        .mockResolvedValue([{ code: 'P1', name: 'Producto uno' }]),
    };
    const integrationsRepository = {
      findByCompanyAndProvider: jest
        .fn()
        .mockResolvedValue({ id: 'integration-1' }),
    };
    const historialFacturasRepository = {
      findRecentInvoicesBySupplier: jest.fn().mockResolvedValue([]),
    };
    const siigoAccountsRepository = {
      findTransactionalByCompanyAndIntegration: jest
        .fn()
        .mockResolvedValue([{ code: '5135', name: 'Gastos diversos' }]),
    };
    const supplierConfigurationsRepository = {
      findByCompanyIntegrationAndNormalizedSupplierDocument: jest
        .fn()
        .mockResolvedValue(null),
    };
    const companiesRepository = {
      findById: jest.fn().mockResolvedValue({ name: 'MAGNA FILIA SAS' }),
    };

    const service = new SiigoAiAccountSuggestionService(
      openRouterHttpClient as any,
      electronicDocumentService as any,
      {} as any,
      siigoProductsCatalogService as any,
      {} as any,
      integrationsRepository as any,
      historialFacturasRepository as any,
      siigoAccountsRepository as any,
      supplierConfigurationsRepository as any,
      companiesRepository as any,
    );

    return { service, siigoProductsCatalogService };
  }

  it('no consulta el catálogo de productos para Documento soporte — fuerza el prompt "solo cuenta" para que la IA nunca elija Producto', async () => {
    const document = {
      id: 'doc-1',
      electronicDocumentType: ElectronicDocumentType.SUPPORT_DOCUMENT,
      payload: {
        supplier: { name: 'Proveedor SAS', documentNumber: '900123456' },
        items: [{ descripcion: 'Servicio de aseo' }],
      },
    };
    const { service, siigoProductsCatalogService } = buildService(document);

    await service.classifyItemTypeAndAccount('doc-1', 'company-1');

    expect(siigoProductsCatalogService.listProducts).not.toHaveBeenCalled();
  });

  it('sí consulta el catálogo de productos para Factura de compra (comportamiento sin cambios)', async () => {
    const document = {
      id: 'doc-1',
      electronicDocumentType: ElectronicDocumentType.PURCHASE_INVOICE,
      payload: {
        supplier: { name: 'Proveedor SAS', documentNumber: '900123456' },
        items: [{ descripcion: 'Servicio de aseo' }],
      },
    };
    const { service, siigoProductsCatalogService } = buildService(document);

    await service.classifyItemTypeAndAccount('doc-1', 'company-1');

    expect(siigoProductsCatalogService.listProducts).toHaveBeenCalledWith(
      'company-1',
    );
  });
});

describe('SiigoAiAccountSuggestionService.classifyItemTypeAndAccount — siempre hay cuenta si existe catálogo', () => {
  function buildAccountService(params: {
    aiContent: string;
    historicalRows?: Array<{
      descripcionItem: string;
      cuentaPuc: string;
      tipo: HistorialFacturaTipo;
      facturaId?: string;
      fechaFactura?: string;
      fuente?: HistorialFacturaFuente;
    }>;
  }) {
    const document = {
      id: 'doc-1',
      electronicDocumentType: ElectronicDocumentType.SUPPORT_DOCUMENT,
      payload: {
        supplier: { name: 'Proveedor SAS', documentNumber: '900123456' },
        items: [{ descripcion: 'Servicio de aseo' }],
      },
    };
    const openRouterHttpClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      createChatCompletion: jest.fn().mockResolvedValue({
        content: params.aiContent,
      }),
    };
    const service = new SiigoAiAccountSuggestionService(
      openRouterHttpClient as any,
      { requireById: jest.fn().mockResolvedValue(document) } as any,
      {} as any,
      { listProducts: jest.fn().mockResolvedValue([]) } as any,
      {} as any,
      {
        findByCompanyAndProvider: jest
          .fn()
          .mockResolvedValue({ id: 'integration-1' }),
      } as any,
      {
        findRecentInvoicesBySupplier: jest
          .fn()
          .mockResolvedValue(params.historicalRows ?? []),
      } as any,
      {
        findTransactionalByCompanyAndIntegration: jest.fn().mockResolvedValue([
          { code: '51050601', name: 'Aseo' },
          { code: '51959501', name: 'Diversos' },
        ]),
      } as any,
      {
        findByCompanyIntegrationAndNormalizedSupplierDocument: jest
          .fn()
          .mockResolvedValue(null),
      } as any,
      { findById: jest.fn().mockResolvedValue({ name: 'MAGNA FILIA SAS' }) } as any,
    );

    return service;
  }

  it('si la IA devuelve un código inexistente, usa el histórico comparable con confidence de factura similar', async () => {
    const service = buildAccountService({
      aiContent: '{"items":[{"accountCode":"NO-EXISTE","confidence":90}]}',
      historicalRows: [
        {
          descripcionItem: 'Servicio de aseo mensual',
          cuentaPuc: '51050601',
          tipo: HistorialFacturaTipo.CUENTA,
          facturaId: 'fac-1',
          fechaFactura: '2026-09-01',
          fuente: HistorialFacturaFuente.SIIGO_ORIGINAL,
        },
      ],
    });

    const result = await service.classifyItemTypeAndAccount(
      'doc-1',
      'company-1',
    );

    expect(result.accountCode).toBe('51050601');
    expect(result.accountName).toBe('Aseo');
    expect(result.items[0].confidence).toBe(ACCOUNT_CONFIDENCE.SIMILAR_INVOICE);
  });

  it('si el parseo no trae accountCode, usa la primera cuenta del catálogo con confidence baja', async () => {
    const service = buildAccountService({
      aiContent: '{"items":[{"accountCode":null,"confidence":40}]}',
    });

    const result = await service.classifyItemTypeAndAccount(
      'doc-1',
      'company-1',
    );

    expect(result.accountCode).toBe('51050601');
    expect(result.accountName).toBe('Aseo');
    expect(result.items[0].confidence).toBe(ACCOUNT_CONFIDENCE.CATALOG);
  });

  it('si la IA devuelve un código del catálogo sin historial, usa esa cuenta con confidence de catálogo', async () => {
    const service = buildAccountService({
      aiContent: '{"items":[{"accountCode":"51959501","confidence":75}]}',
    });

    const result = await service.classifyItemTypeAndAccount(
      'doc-1',
      'company-1',
    );

    expect(result.accountCode).toBe('51959501');
    expect(result.accountName).toBe('Diversos');
    expect(result.items[0].confidence).toBe(ACCOUNT_CONFIDENCE.CATALOG);
  });
});

describe('SiigoAiAccountSuggestionService.suggestForDocument', () => {
  it('reusa classifyItemTypeAndAccount para la cuenta y solo pide IVA/retenciones', async () => {
    const document = {
      id: 'doc-1',
      payload: {
        supplier: { name: 'Proveedor SAS', documentNumber: '900123456' },
        items: [
          {
            descripcion: 'Papelería',
            cantidad: 1,
            valorUnitario: 1000,
            total: 1000,
          },
        ],
      },
    };
    const openRouterHttpClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      createChatCompletion: jest.fn().mockResolvedValue({
        content: '{"taxId":11792,"retentionIds":[11811]}',
      }),
    };
    const electronicDocumentService = {
      requireById: jest.fn().mockResolvedValue(document),
      updatePayload: jest.fn().mockResolvedValue(undefined),
    };
    const siigoTaxesCatalogService = {
      listTaxes: jest.fn().mockResolvedValue([
        {
          id: 11792,
          name: 'IVA 19%',
          type: 'IVA',
          percentage: 19,
          active: true,
        },
        {
          id: 11811,
          name: 'Retefuente 1%',
          type: 'Retefuente',
          percentage: 1,
          active: true,
        },
      ]),
    };
    const integrationsRepository = {
      findByCompanyAndProvider: jest
        .fn()
        .mockResolvedValue({ id: 'integration-1' }),
    };
    const historialFacturasRepository = {
      findRecentInvoicesBySupplier: jest.fn().mockResolvedValue([]),
    };

    const service = new SiigoAiAccountSuggestionService(
      openRouterHttpClient as any,
      electronicDocumentService as any,
      {} as any,
      {} as any,
      siigoTaxesCatalogService as any,
      integrationsRepository as any,
      historialFacturasRepository as any,
      {} as any,
      {} as any,
      {} as any,
    );

    jest.spyOn(service, 'classifyItemTypeAndAccount').mockResolvedValue({
      itemType: 'Account',
      accountCode: '51953001',
      accountName: 'Papelería',
      productCode: null,
      productName: null,
      confidence: 80,
      items: [
        {
          accountCode: '51953001',
          accountName: 'Papelería',
          productCode: null,
          productName: null,
          confidence: 80,
        },
      ],
    });

    const result = await service.suggestForDocument('doc-1', 'company-1');

    expect(result.accountCode).toBe('51953001');
    expect(result.accountName).toBe('Papelería');
    expect(result.taxId).toBe(11792);
    expect(result.retentionSuggestions).toEqual([
      {
        id: 11811,
        name: 'Retefuente 1%',
        type: 'Retefuente',
        percentage: 1,
      },
    ]);
    expect(openRouterHttpClient.createChatCompletion).toHaveBeenCalledTimes(1);
    const [messages, options] =
      openRouterHttpClient.createChatCompletion.mock.calls[0];
    expect(options.context.purpose).toBe('purchase-tax-classification');
    expect(messages[0].content).toContain('NO elijas cuenta');
    expect(messages[1].content).not.toContain('Cuentas PUC');
    expect(electronicDocumentService.updatePayload).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        items: [
          expect.objectContaining({
            accountMapping: {
              code: '51953001',
              description: 'Papelería',
            },
          }),
        ],
      }),
      'company-1',
    );
  });
});
