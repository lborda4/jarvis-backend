import {
  buildAccountCodeClassificationPrompt,
  buildItemTypeClassificationPrompt,
  buildProductCodeClassificationPrompt,
  parseAccountCodeClassificationResponse,
  parseItemTypeClassificationResponse,
  parseProductCodeClassificationResponse,
} from './purchase-item-classification-prompt.helper';

describe('buildItemTypeClassificationPrompt (paso 1 — sin catálogos)', () => {
  it('incluye proveedor e ítems, pero ningún catálogo', () => {
    const messages = buildItemTypeClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      items: [{ descripcion: 'Servicio de internet' }],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Proveedor S.A.S');
    expect(messages[1].content).toContain('Servicio de internet');
    expect(messages[1].content).not.toContain('Cuentas PUC');
    expect(messages[1].content).not.toContain('Catálogo de productos');
  });

  it('pide solo itemType, sin accountCode/productCode/confidence', () => {
    const messages = buildItemTypeClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      items: [{ descripcion: 'X' }],
    });

    expect(messages[0].content).toContain('{"itemType":"Account"|"Product"}');
  });
});

describe('parseItemTypeClassificationResponse', () => {
  it('parsea Account/Product válidos', () => {
    expect(
      parseItemTypeClassificationResponse('{"itemType":"Account"}'),
    ).toEqual({ itemType: 'Account' });
    expect(
      parseItemTypeClassificationResponse('{"itemType":"Product"}'),
    ).toEqual({ itemType: 'Product' });
  });

  it('devuelve null si no es JSON válido o el valor no es Account/Product', () => {
    expect(parseItemTypeClassificationResponse('no puedo ayudar')).toEqual({
      itemType: null,
    });
    expect(parseItemTypeClassificationResponse('{"itemType":"Otro"}')).toEqual({
      itemType: null,
    });
  });

  it('extrae el JSON aunque el modelo agregue texto alrededor', () => {
    expect(
      parseItemTypeClassificationResponse(
        'Respuesta:\n{"itemType":"Product"}\nFin.',
      ),
    ).toEqual({ itemType: 'Product' });
  });
});

describe('buildAccountCodeClassificationPrompt (paso 2a — solo cuentas)', () => {
  it('incluye proveedor, empresa que compra, ítems y catálogo de cuentas, sin catálogo de productos', () => {
    const messages = buildAccountCodeClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      ourCompanyName: 'MAGNA FILIA SAS',
      items: [{ descripcion: 'Servicio de internet' }],
      accounts: [{ code: '51356001', name: 'Servicios de internet' }],
    });

    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain('Proveedor S.A.S');
    expect(messages[1].content).toContain('MAGNA FILIA SAS');
    expect(messages[1].content).toContain('Servicio de internet');
    expect(messages[1].content).toContain('51356001');
    expect(messages[1].content).not.toContain('Catálogo de productos');
  });

  it('pide confidence pero no rationale/IVA/retenciones/itemType', () => {
    const messages = buildAccountCodeClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      ourCompanyName: 'Nosotros',
      items: [{ descripcion: 'X' }],
      accounts: [],
    });

    expect(messages[0].content).toMatch(/confidence/i);
    expect(messages[0].content).not.toMatch(/rationale/i);
    expect(messages[0].content).not.toMatch(/IVA/);
    expect(messages[0].content).not.toMatch(/retenci/i);
    expect(messages[0].content).not.toContain('itemType');
  });

  it('prioriza ejemplos equivalentes y prohíbe inferir significados no respaldados', () => {
    const messages = buildAccountCodeClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      ourCompanyName: 'Nosotros',
      items: [{ descripcion: 'REF ABC-123' }],
      accounts: [{ code: '51959501', name: 'Diversos' }],
    });

    expect(messages[0].content).toContain(
      'ejemplo previo del MISMO proveedor',
    );
    expect(messages[0].content).toContain(
      'No inventes ni completes significados',
    );
    expect(messages[0].content).toContain(
      'accountCode NUNCA puede ser null',
    );
    expect(messages[0].content).toContain(
      '{"accountCode":string,"confidence":number}',
    );
  });

  it('incluye los ejemplos históricos cuando se proveen', () => {
    const messages = buildAccountCodeClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      ourCompanyName: 'Nosotros',
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
    const messages = buildAccountCodeClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      ourCompanyName: 'Nosotros',
      items: [{ descripcion: 'X' }],
      accounts: [],
    });

    expect(messages[1].content).not.toContain('Ejemplos previos');
  });
});

describe('parseAccountCodeClassificationResponse', () => {
  it('parsea un JSON válido con código y confidence', () => {
    expect(
      parseAccountCodeClassificationResponse(
        '{"accountCode": "51356001", "confidence": 92}',
      ),
    ).toEqual({ accountCode: '51356001', confidence: 92 });
  });

  it('clampea confidence fuera de [0, 100]', () => {
    expect(
      parseAccountCodeClassificationResponse(
        '{"accountCode": "X", "confidence": 140}',
      ).confidence,
    ).toBe(100);
    expect(
      parseAccountCodeClassificationResponse(
        '{"accountCode": "X", "confidence": -20}',
      ).confidence,
    ).toBe(0);
  });

  it('confidence null si no es numérico; accountCode null si no viene', () => {
    expect(
      parseAccountCodeClassificationResponse(
        '{"accountCode": "X", "confidence": "alta"}',
      ).confidence,
    ).toBeNull();
    expect(
      parseAccountCodeClassificationResponse('{"confidence": 80}').accountCode,
    ).toBeNull();
  });

  it('devuelve todo null si la respuesta no es JSON válido', () => {
    expect(parseAccountCodeClassificationResponse('no puedo ayudar')).toEqual({
      accountCode: null,
      confidence: null,
    });
  });
});

describe('buildProductCodeClassificationPrompt (paso 2b — solo productos)', () => {
  it('incluye proveedor, empresa que compra, ítems y catálogo de productos, sin catálogo de cuentas', () => {
    const messages = buildProductCodeClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      ourCompanyName: 'MAGNA FILIA SAS',
      items: [{ descripcion: 'Galleta de leche' }],
      products: [{ code: 'PROD-001', name: 'Galleta surtida' }],
    });

    expect(messages[1].content).toContain('MAGNA FILIA SAS');
    expect(messages[1].content).toContain('Galleta de leche');
    expect(messages[1].content).toContain('PROD-001');
    expect(messages[1].content).not.toContain('Cuentas PUC');
  });

  it('incluye los ejemplos históricos cuando se proveen', () => {
    const messages = buildProductCodeClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      ourCompanyName: 'Nosotros',
      items: [{ descripcion: 'X' }],
      products: [],
      historicalExamples: [
        { descripcionItem: 'Galleta MUUU leche C', cuentaPuc: 'PROD-001' },
      ],
    });

    expect(messages[1].content).toContain('Galleta MUUU leche C');
    expect(messages[1].content).toContain('PROD-001');
  });
});

describe('parseProductCodeClassificationResponse', () => {
  it('parsea un JSON válido con código y confidence', () => {
    expect(
      parseProductCodeClassificationResponse(
        '{"productCode": "PROD-001", "confidence": 75}',
      ),
    ).toEqual({ productCode: 'PROD-001', confidence: 75 });
  });

  it('devuelve todo null si la respuesta no es JSON válido', () => {
    expect(parseProductCodeClassificationResponse('no puedo ayudar')).toEqual({
      productCode: null,
      confidence: null,
    });
  });
});
