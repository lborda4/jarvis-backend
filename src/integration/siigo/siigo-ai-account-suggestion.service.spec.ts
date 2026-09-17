import {
  SiigoAiAccountSuggestionService,
  selectProductsForClassificationPrompt,
} from './siigo-ai-account-suggestion.service';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';

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
      findRecentBySupplier: jest.fn().mockResolvedValue([]),
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
