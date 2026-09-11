import {
  PurchaseInvoiceReviewInput,
  resolvePurchaseInvoiceRequiresReview,
} from './purchase-invoice-review.helper';

const PAYMENT_METHOD_ID = 42;

function buildInput(
  overrides: Partial<PurchaseInvoiceReviewInput> = {},
): PurchaseInvoiceReviewInput {
  return {
    draft: null,
    payloadItems: [],
    suggestedAccount: null,
    suggestedProduct: null,
    suggestedItemConfig: null,
    itemAccountSuggestions: [],
    aiConfidence: null,
    ...overrides,
  };
}

describe('resolvePurchaseInvoiceRequiresReview — con borrador guardado', () => {
  it('caso real D1 SAS: ítems Cuenta sin código Y sin cuenta de respaldo — requiere revisión', () => {
    const result = resolvePurchaseInvoiceRequiresReview(
      buildInput({
        draft: {
          items: [
            { tipo: 'Account', producto: '', description: '', quantity: 1, unitValue: 0, discount: 0 },
            { tipo: 'Account', producto: '', description: '', quantity: 1, unitValue: 0, discount: 0 },
          ],
          paymentMethodId: PAYMENT_METHOD_ID,
          savedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    expect(result).toBe(true);
  });

  it('no requiere revisión si el borrador trae cuenta de respaldo a nivel de documento', () => {
    const result = resolvePurchaseInvoiceRequiresReview(
      buildInput({
        draft: {
          items: [
            { tipo: 'Account', producto: '', description: '', quantity: 1, unitValue: 0, discount: 0 },
          ],
          accountCode: '5115',
          paymentMethodId: PAYMENT_METHOD_ID,
          savedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    expect(result).toBe(false);
  });

  it('no requiere revisión si cada ítem Cuenta ya trae su propio código', () => {
    const result = resolvePurchaseInvoiceRequiresReview(
      buildInput({
        draft: {
          items: [
            { tipo: 'Account', producto: '5115', description: '', quantity: 1, unitValue: 0, discount: 0 },
          ],
          paymentMethodId: PAYMENT_METHOD_ID,
          savedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    expect(result).toBe(false);
  });

  it('un ítem Producto sin código SIEMPRE requiere revisión, aunque haya cuenta de respaldo', () => {
    const result = resolvePurchaseInvoiceRequiresReview(
      buildInput({
        draft: {
          items: [
            { tipo: 'Product', producto: '', description: '', quantity: 1, unitValue: 0, discount: 0 },
          ],
          accountCode: '5115',
          paymentMethodId: PAYMENT_METHOD_ID,
          savedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    expect(result).toBe(true);
  });

  it('requiere revisión si el borrador no trae medio de pago', () => {
    const result = resolvePurchaseInvoiceRequiresReview(
      buildInput({
        draft: {
          items: [
            { tipo: 'Account', producto: '5115', description: '', quantity: 1, unitValue: 0, discount: 0 },
          ],
          savedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    expect(result).toBe(true);
  });
});

describe('resolvePurchaseInvoiceRequiresReview — sin borrador (solo sugerencias)', () => {
  it('sin ninguna sugerencia y sin ítems, requiere revisión', () => {
    expect(resolvePurchaseInvoiceRequiresReview(buildInput())).toBe(true);
  });

  it('cuenta sugerida a nivel de documento + medio de pago sugerido alcanza para no requerir revisión', () => {
    const result = resolvePurchaseInvoiceRequiresReview(
      buildInput({
        payloadItems: [
          { descripcion: 'Item', cantidad: 1, valorUnitario: 100, total: 100 },
        ],
        suggestedItemConfig: {
          itemType: 'Account',
          accountCode: '5115',
          accountName: 'Gastos',
          productCode: null,
          productName: null,
          ivaTax: null,
          retefuenteTax: null,
          paymentMethod: { id: PAYMENT_METHOD_ID, name: 'Contado', type: 'CASH' },
        },
      }),
    );

    expect(result).toBe(false);
  });

  it('caso real reportado: cuenta ya resuelta pero medio de pago sin resolver — igual requiere revisión', () => {
    const result = resolvePurchaseInvoiceRequiresReview(
      buildInput({
        payloadItems: [
          { descripcion: 'Item', cantidad: 1, valorUnitario: 100, total: 100 },
        ],
        suggestedAccount: { code: '5115', name: 'Gastos', uses: 3 },
      }),
    );

    expect(result).toBe(true);
  });

  it('una regla exacta por ítem (source: exact) resuelve ese ítem aunque el proveedor no tenga cuenta dominante', () => {
    const result = resolvePurchaseInvoiceRequiresReview(
      buildInput({
        payloadItems: [
          { descripcion: 'Item', cantidad: 1, valorUnitario: 100, total: 100 },
        ],
        itemAccountSuggestions: [{ code: '5115', name: 'Gastos', source: 'exact' }],
        suggestedItemConfig: {
          itemType: 'Product',
          accountCode: null,
          accountName: null,
          productCode: null,
          productName: null,
          ivaTax: null,
          retefuenteTax: null,
          paymentMethod: { id: PAYMENT_METHOD_ID, name: 'Contado', type: 'CASH' },
        },
      }),
    );

    // La regla exacta fuerza tipo 'Account' para ESE ítem (independiente del
    // itemType dominante del proveedor, que acá es 'Product') y ya trae su
    // propio código, así que no hace falta cuenta de respaldo.
    expect(result).toBe(false);
  });

  it('producto sugerido por IA a nivel de documento resuelve un ítem Producto sin código propio', () => {
    const result = resolvePurchaseInvoiceRequiresReview(
      buildInput({
        payloadItems: [
          { descripcion: 'Item', cantidad: 1, valorUnitario: 100, total: 100 },
        ],
        suggestedProduct: { code: 'PROD-1', name: 'Producto' },
        suggestedItemConfig: {
          itemType: 'Product',
          accountCode: null,
          accountName: null,
          productCode: null,
          productName: null,
          ivaTax: null,
          retefuenteTax: null,
          paymentMethod: { id: PAYMENT_METHOD_ID, name: 'Contado', type: 'CASH' },
        },
      }),
    );

    expect(result).toBe(false);
  });

  it('requiere revisión si la confianza de IA es menor a 80, aunque todo lo demás esté resuelto', () => {
    const result = resolvePurchaseInvoiceRequiresReview(
      buildInput({
        payloadItems: [
          { descripcion: 'Item', cantidad: 1, valorUnitario: 100, total: 100 },
        ],
        suggestedAccount: { code: '5115', name: 'Gastos', uses: 3 },
        suggestedItemConfig: {
          itemType: 'Account',
          accountCode: '5115',
          accountName: 'Gastos',
          productCode: null,
          productName: null,
          ivaTax: null,
          retefuenteTax: null,
          paymentMethod: { id: PAYMENT_METHOD_ID, name: 'Contado', type: 'CASH' },
        },
        aiConfidence: 79,
      }),
    );

    expect(result).toBe(true);
  });

  it('no requiere revisión por confianza cuando es null (la clasificación nunca corrió)', () => {
    const result = resolvePurchaseInvoiceRequiresReview(
      buildInput({
        payloadItems: [
          { descripcion: 'Item', cantidad: 1, valorUnitario: 100, total: 100 },
        ],
        suggestedAccount: { code: '5115', name: 'Gastos', uses: 3 },
        suggestedItemConfig: {
          itemType: 'Account',
          accountCode: '5115',
          accountName: 'Gastos',
          productCode: null,
          productName: null,
          ivaTax: null,
          retefuenteTax: null,
          paymentMethod: { id: PAYMENT_METHOD_ID, name: 'Contado', type: 'CASH' },
        },
        aiConfidence: null,
      }),
    );

    expect(result).toBe(false);
  });
});
