import {
  buildPurchaseItemClassificationPrompt,
  parsePurchaseItemClassificationResponse,
} from './purchase-item-classification-prompt.helper';

describe('buildPurchaseItemClassificationPrompt', () => {
  it('incluye proveedor, ítems y catálogo de cuentas en el mensaje de usuario', () => {
    const messages = buildPurchaseItemClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      items: [{ descripcion: 'Servicio de internet' }],
      accounts: [{ code: '51356001', name: 'Servicios de internet' }],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Proveedor S.A.S');
    expect(messages[1].content).toContain('Servicio de internet');
    expect(messages[1].content).toContain('51356001');
  });

  it('no pide confidence/rationale/IVA/retenciones en el prompt', () => {
    const messages = buildPurchaseItemClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      items: [{ descripcion: 'X' }],
      accounts: [],
    });

    expect(messages[0].content).not.toMatch(/confidence/i);
    expect(messages[0].content).not.toMatch(/rationale/i);
    expect(messages[0].content).not.toMatch(/IVA/);
    expect(messages[0].content).not.toMatch(/retenci/i);
  });

  it('incluye los ejemplos históricos cuando se proveen', () => {
    const messages = buildPurchaseItemClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      items: [{ descripcion: 'Servicio Línea Telefónica' }],
      accounts: [],
      historicalExamples: [
        {
          descripcionItem: 'Servicio Línea Telefónica Enero',
          cuentaPuc: '51356002',
        },
      ],
    });

    expect(messages[1].content).toContain('Servicio Línea Telefónica Enero');
    expect(messages[1].content).toContain('51356002');
  });

  it('no incluye la sección de ejemplos históricos cuando no se proveen', () => {
    const messages = buildPurchaseItemClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      items: [{ descripcion: 'X' }],
      accounts: [],
    });

    expect(messages[1].content).not.toContain('Ejemplos previos');
  });

  it('sin catálogo de productos, no ofrece "Producto" como opción — solo pide cuenta (caso real: empresa sin productos en SIIGO clasificaba snacks como Producto e inventaba un código de cuenta en el campo equivocado)', () => {
    const messages = buildPurchaseItemClassificationPrompt({
      supplierName: 'D1 SAS',
      items: [{ descripcion: 'GALLETA MUUU LECHE' }],
      accounts: [{ code: '51952503', name: 'Elementos de aseo y Cafetería' }],
      products: [],
    });

    expect(messages[0].content).toContain('SIEMPRE "Account"');
    expect(messages[0].content).toContain('"itemType":"Account"|null');
    expect(messages[0].content).not.toContain('"Account"|"Product"');
    expect(messages[1].content).not.toContain('Catálogo de productos');
  });

  it('con catálogo de productos no vacío, sí ofrece "Producto" como opción', () => {
    const messages = buildPurchaseItemClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      items: [{ descripcion: 'X' }],
      accounts: [],
      products: [{ code: 'PROD-001', name: 'Producto de prueba' }],
    });

    expect(messages[0].content).toContain('"Account"|"Product"');
    expect(messages[1].content).toContain('Catálogo de productos');
    expect(messages[1].content).toContain('PROD-001');
  });
});

describe('parsePurchaseItemClassificationResponse', () => {
  it('parsea un JSON válido de tipo Cuenta con su código', () => {
    const result = parsePurchaseItemClassificationResponse(
      '{"itemType": "Account", "accountCode": "51356001"}',
    );

    expect(result).toEqual({
      itemType: 'Account',
      accountCode: '51356001',
      productCode: null,
    });
  });

  it('parsea un JSON válido de tipo Producto con su código', () => {
    const result = parsePurchaseItemClassificationResponse(
      '{"itemType": "Product", "productCode": "PROD-001"}',
    );

    expect(result).toEqual({
      itemType: 'Product',
      accountCode: null,
      productCode: 'PROD-001',
    });
  });

  it('ignora accountCode si el tipo es Producto, y productCode si el tipo es Cuenta', () => {
    const asProduct = parsePurchaseItemClassificationResponse(
      '{"itemType": "Product", "accountCode": "51356001", "productCode": "PROD-001"}',
    );
    const asAccount = parsePurchaseItemClassificationResponse(
      '{"itemType": "Account", "accountCode": "51356001", "productCode": "PROD-001"}',
    );

    expect(asProduct.accountCode).toBeNull();
    expect(asProduct.productCode).toBe('PROD-001');
    expect(asAccount.accountCode).toBe('51356001');
    expect(asAccount.productCode).toBeNull();
  });

  it('extrae el JSON aunque el modelo agregue texto alrededor', () => {
    const result = parsePurchaseItemClassificationResponse(
      'Aquí está mi respuesta:\n{"itemType": "Account", "accountCode": "51356001"}\nFin.',
    );

    expect(result).toEqual({
      itemType: 'Account',
      accountCode: '51356001',
      productCode: null,
    });
  });

  it('devuelve todo null si la respuesta no es JSON válido', () => {
    const result = parsePurchaseItemClassificationResponse(
      'no puedo ayudar con eso',
    );

    expect(result).toEqual({
      itemType: null,
      accountCode: null,
      productCode: null,
    });
  });

  it('devuelve itemType null si el valor no es Account ni Product', () => {
    const result = parsePurchaseItemClassificationResponse(
      '{"itemType": "Otro", "accountCode": "51356001"}',
    );

    expect(result).toEqual({
      itemType: null,
      accountCode: null,
      productCode: null,
    });
  });
});
