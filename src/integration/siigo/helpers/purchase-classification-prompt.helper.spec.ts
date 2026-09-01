import {
  buildPurchaseClassificationPrompt,
  parsePurchaseClassificationResponse,
} from './purchase-classification-prompt.helper';

describe('buildPurchaseClassificationPrompt', () => {
  it('incluye ítems, cuentas, IVA y retenciones en el mensaje de usuario', () => {
    const messages = buildPurchaseClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      items: [
        {
          descripcion: 'Papelería de oficina',
          cantidad: 2,
          valorUnitario: 15000,
        },
      ],
      accounts: [{ code: '519530', name: 'Papelería y útiles de oficina' }],
      taxes: [
        {
          id: 11792,
          name: 'IVA 19%',
          type: 'IVA',
          percentage: 19,
          active: true,
        },
      ],
      retentionTaxes: [
        {
          id: 11811,
          name: 'Retefuente 1%',
          type: 'Retefuente',
          percentage: 1,
          active: true,
        },
      ],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Papelería de oficina');
    expect(messages[1].content).toContain('519530');
    expect(messages[1].content).toContain('11792');
    expect(messages[1].content).toContain('11811');
  });

  it('no pide confidence/rationale en el prompt', () => {
    const messages = buildPurchaseClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      items: [{ descripcion: 'X', cantidad: 1, valorUnitario: 1 }],
      accounts: [],
      taxes: [],
    });

    expect(messages[0].content).not.toMatch(/confidence/i);
    expect(messages[0].content).not.toMatch(/rationale/i);
  });

  it('incluye los ejemplos históricos cuando se proveen, marcando los confirmados por el contador', () => {
    const messages = buildPurchaseClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      items: [
        { descripcion: 'Servicio de aseo', cantidad: 1, valorUnitario: 100000 },
      ],
      accounts: [],
      taxes: [],
      historicalExamples: [
        {
          descripcionItem: 'Servicio de aseo mensual',
          cuentaPuc: '511010',
          impuestos: { iva: { id: 1, name: 'IVA 19%', percentage: 19 } },
          confirmadaPorContador: true,
        },
      ],
    });

    expect(messages[1].content).toContain('Servicio de aseo mensual');
    expect(messages[1].content).toContain('(confirmado)');
    expect(messages[1].content).toContain('511010');
  });

  it('no incluye la sección de ejemplos históricos cuando no se proveen', () => {
    const messages = buildPurchaseClassificationPrompt({
      supplierName: 'Proveedor S.A.S',
      items: [{ descripcion: 'X', cantidad: 1, valorUnitario: 1 }],
      accounts: [],
      taxes: [],
    });

    expect(messages[1].content).not.toContain('Ejemplos previos');
  });
});

describe('parsePurchaseClassificationResponse', () => {
  it('parsea un JSON válido devuelto por el modelo', () => {
    const result = parsePurchaseClassificationResponse(
      '{"accountCode": "519530", "taxId": 11792, "retentionIds": [11811, 11798]}',
    );

    expect(result).toEqual({
      accountCode: '519530',
      taxId: 11792,
      retentionIds: [11811, 11798],
    });
  });

  it('extrae el JSON aunque el modelo agregue texto alrededor', () => {
    const result = parsePurchaseClassificationResponse(
      'Aquí está mi respuesta:\n{"accountCode": "519530", "taxId": null, "retentionIds": []}\nFin.',
    );

    expect(result.accountCode).toBe('519530');
    expect(result.taxId).toBeNull();
    expect(result.retentionIds).toEqual([]);
  });

  it('devuelve todo vacío/null si la respuesta no es JSON válido', () => {
    const result = parsePurchaseClassificationResponse(
      'no puedo ayudar con eso',
    );

    expect(result).toEqual({
      accountCode: null,
      taxId: null,
      retentionIds: [],
    });
  });

  it('devuelve null/vacío en campos con tipos inesperados en vez de lanzar', () => {
    const result = parsePurchaseClassificationResponse(
      '{"accountCode": 123, "taxId": "abc", "retentionIds": "no-array"}',
    );

    expect(result).toEqual({
      accountCode: null,
      taxId: null,
      retentionIds: [],
    });
  });

  it('filtra del array retentionIds cualquier valor que no sea número finito', () => {
    const result = parsePurchaseClassificationResponse(
      '{"accountCode": null, "taxId": null, "retentionIds": [1, "x", null, 2]}',
    );

    expect(result.retentionIds).toEqual([1, 2]);
  });
});
