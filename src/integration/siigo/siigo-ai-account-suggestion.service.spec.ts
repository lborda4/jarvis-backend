import { BadGatewayException } from '@nestjs/common';
import { parseAccountCodeClassificationResponse } from './helpers/purchase-item-classification-prompt.helper';
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
        content:
          '{"itemType":"Account","items":[{"itemId":"1","accountCode":"5135","confidence":80}]}',
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
      findById: jest.fn().mockResolvedValue({
        name: 'MAGNA FILIA SAS',
        description: 'Restaurante de comida rápida.',
      }),
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

    return { service, siigoProductsCatalogService, openRouterHttpClient };
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

  it('envía la descripción de la empresa en el prompt de cuenta de Documento soporte', async () => {
    const document = {
      id: 'doc-1',
      electronicDocumentType: ElectronicDocumentType.SUPPORT_DOCUMENT,
      payload: {
        supplier: { name: 'Proveedor SAS', documentNumber: '900123456' },
        items: [{ descripcion: 'Aceite de cocina' }],
      },
    };
    const { service, openRouterHttpClient } = buildService(document);

    await service.classifyItemTypeAndAccount('doc-1', 'company-1');

    expect(openRouterHttpClient.createChatCompletion).toHaveBeenCalledTimes(1);
    const [messages] = openRouterHttpClient.createChatCompletion.mock.calls[0];
    const userContent = messages.find(
      (message: { role: string }) => message.role === 'user',
    )?.content as string;
    const systemContent = messages.find(
      (message: { role: string }) => message.role === 'system',
    )?.content as string;

    expect(userContent).toContain('Documento: Documento soporte');
    expect(userContent).toContain(
      'A qué se dedica: Restaurante de comida rápida.',
    );
    expect(systemContent).toContain('documento soporte');
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

describe('SiigoAiAccountSuggestionService.classifyItemTypeAndAccount — validacion por ID y catalogo', () => {
  function buildAccountService(params: {
    aiContent: string;
    responses?: string[];
    descriptions?: string[];
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
        items: (params.descriptions ?? ['Aseo']).map((descripcion) => ({
          descripcion,
        })),
      },
    };
    const openRouterHttpClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      createChatCompletion: jest.fn().mockResolvedValue({
        content: params.aiContent,
      }),
    };
    for (const content of params.responses ?? []) {
      openRouterHttpClient.createChatCompletion.mockResolvedValueOnce({
        content,
      });
    }
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
      {
        findById: jest.fn().mockResolvedValue({ name: 'MAGNA FILIA SAS' }),
      } as any,
    );

    return Object.assign(service, {
      completionMock: openRouterHttpClient.createChatCompletion,
    });
  }

  it('divide 31 items en lotes de 15 y reintenta solo los pendientes con el mismo contexto', async () => {
    const ids = Array.from({ length: 31 }, (_, index) => String(index + 1));
    const response = (itemIds: string[]) =>
      JSON.stringify({
        items: [...itemIds].reverse().map((itemId) => ({
          itemId,
          accountCode: itemId === '8' ? '51959501' : '51050601',
          confidence: 80,
        })),
      });
    const service = buildAccountService({
      descriptions: ids.map((id) => `Concepto ${id}`),
      responses: [
        response(ids.slice(0, 15).filter((id) => id !== '8')),
        response(ids.slice(15, 30)),
        response(ids.slice(30)),
      ],
      aiContent: response(['8']),
    });

    const result = await service.classifyItemTypeAndAccount(
      'doc-1',
      'company-1',
    );

    expect(result.items.map((item) => item.accountCode)).toEqual(
      ids.map((id) => (id === '8' ? '51959501' : '51050601')),
    );
    expect(service.completionMock).toHaveBeenCalledTimes(4);
    const calls = service.completionMock.mock.calls as unknown as Array<
      [
        Array<{ content: string }>,
        { context: { companyId: string; documentId: string; purpose: string } },
      ]
    >;
    const expectedIds = [
      ids.slice(0, 15),
      ids.slice(15, 30),
      ids.slice(30),
      ['8'],
    ];
    calls.forEach(([messages, options], index) => {
      const content = messages[1].content;
      expect(
        [...content.matchAll(/itemId="([^"]+)"/g)].map((match) => match[1]),
      ).toEqual(expectedIds[index]);
      expect(content).toContain('MAGNA FILIA SAS');
      expect(content).toContain('Proveedor SAS');
      expect(content).toContain('Documento: Documento soporte');
      expect(content).toContain('51050601 Aseo');
      expect(messages[0].content).toBe(calls[0][0][0].content);
      expect(options.context).toEqual({
        companyId: 'company-1',
        documentId: 'doc-1',
        purpose: 'purchase-item-account-code-classification',
      });
    });
  });

  it('reintenta solo el ID omitido y conserva las otras lineas', async () => {
    const service = buildAccountService({
      descriptions: ['Primero', 'Segundo', 'Tercero'],
      responses: [
        '{"items":[{"itemId":"3","accountCode":"51959501"},{"itemId":"1","accountCode":"51050601"}]}',
      ],
      aiContent: '{"items":[{"itemId":"2","accountCode":"51959501"}]}',
    });
    const result = await service.classifyItemTypeAndAccount(
      'doc-1',
      'company-1',
    );
    expect(result.items.map((item) => item.accountCode)).toEqual([
      '51050601',
      '51959501',
      '51959501',
    ]);
    expect(service.completionMock).toHaveBeenCalledTimes(2);
    const retry = service.completionMock.mock.calls[1] as unknown as [
      Array<{ content: string }>,
    ];
    expect(retry[0][1].content).toContain('itemId="2"');
    expect(retry[0][1].content).not.toContain('itemId="1"');
    expect(retry[0][1].content).not.toContain('itemId="3"');
  });

  it('no resume como cuenta comun cuando queda un ID sin resolver', async () => {
    const service = buildAccountService({
      descriptions: ['Primero', 'Segundo'],
      aiContent: '{"items":[{"itemId":"1","accountCode":"51050601"}]}',
    });
    const result = await service.classifyItemTypeAndAccount(
      'doc-1',
      'company-1',
    );
    expect(service.completionMock).toHaveBeenCalledTimes(3);
    expect(result.items.map((item) => item.accountCode)).toEqual([
      '51050601',
      null,
    ]);
    expect(result.accountCode).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('reintenta IDs duplicados aunque sus cuentas existan', async () => {
    const service = buildAccountService({
      responses: [
        '{"items":[{"itemId":"1","accountCode":"51050601"},{"itemId":"1","accountCode":"51959501"}]}',
      ],
      aiContent: '{"items":[{"itemId":"1","accountCode":"51959501"}]}',
    });
    const result = await service.classifyItemTypeAndAccount(
      'doc-1',
      'company-1',
    );
    expect(service.completionMock).toHaveBeenCalledTimes(2);
    expect(result.accountCode).toBe('51959501');
  });

  it('rechaza cuentas inexistentes sin usar el historial', async () => {
    const service = buildAccountService({
      aiContent:
        '{"items":[{"itemId":"1","accountCode":"NO-EXISTE","confidence":90}]}',
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

    expect(service.completionMock).toHaveBeenCalledTimes(3);
    expect(result.accountCode).toBeNull();
    expect(result.accountName).toBeNull();
    expect(result.items[0].confidence).toBe(0);
  });

  it('no asigna la primera cuenta cuando falta el codigo', async () => {
    const service = buildAccountService({
      aiContent:
        '{"items":[{"itemId":"1","accountCode":null,"confidence":40}]}',
    });

    const result = await service.classifyItemTypeAndAccount(
      'doc-1',
      'company-1',
    );

    expect(service.completionMock).toHaveBeenCalledTimes(3);
    expect(result.accountCode).toBeNull();
    expect(result.accountName).toBeNull();
    expect(result.items[0].confidence).toBe(0);
  });

  it('si la IA devuelve un código del catálogo sin historial, usa esa cuenta con confidence de catálogo', async () => {
    const service = buildAccountService({
      aiContent:
        '{"items":[{"itemId":"1","accountCode":"51959501","confidence":75}]}',
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
      electronicDocumentType: ElectronicDocumentType.SUPPORT_DOCUMENT,
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
    const companiesRepository = {
      findById: jest.fn().mockResolvedValue({
        name: 'MAGNA FILIA SAS',
        description: 'Restaurante de comida rápida.',
      }),
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
      companiesRepository as any,
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
    expect(messages[0].content).toContain('documento soporte');
    expect(messages[1].content).not.toContain('Cuentas PUC');
    expect(messages[1].content).toContain('Documento: Documento soporte');
    expect(messages[1].content).toContain(
      'A qué se dedica: Restaurante de comida rápida.',
    );
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

describe('classification recovery', () => {
  it('retries failed calls and preserves resolved lines', async () => {
    const client = {
      createChatCompletion: jest
        .fn()
        .mockResolvedValueOnce({
          content: '{"items":[{"itemId":"1","accountCode":"5135"}]}',
        })
        .mockRejectedValueOnce(new BadGatewayException())
        .mockResolvedValueOnce({
          content: '{"items":[{"itemId":"2","accountCode":"5195"}]}',
        }),
    };
    const service = new SiigoAiAccountSuggestionService(
      client as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const prompt = jest.fn().mockReturnValue([]);
    const result = await (service as any).classifyCodesWithRetries(
      [
        { itemId: '1', descripcion: 'A' },
        { itemId: '2', descripcion: 'B' },
      ],
      prompt,
      parseAccountCodeClassificationResponse,
      (item: any) => Boolean(item.accountCode),
      { companyId: 'c', documentId: 'd', purpose: 'test' },
    );
    expect(result.map((item: any) => item.accountCode)).toEqual([
      '5135',
      '5195',
    ]);
    expect(prompt.mock.calls[1][0]).toEqual([
      { itemId: '2', descripcion: 'B' },
    ]);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(3);
  });
});
