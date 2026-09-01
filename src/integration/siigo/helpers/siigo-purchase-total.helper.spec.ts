import {
  applySiigoCorrectedPaymentsTotal,
  calculateSiigoDocumentPaymentValue,
  calculateSiigoDocumentRetentionTotal,
  calculateSiigoPurchasePaymentValue,
  calculateSiigoSupportDocumentPaymentValue,
  roundMoney,
  roundSiigoAmount,
} from './siigo-purchase-total.helper';

describe('siigo-purchase-total.helper', () => {
  const ivaTaxCatalog = [
    {
      id: 1270,
      name: 'IVA 19%',
      type: 'IVA',
      percentage: 19,
      active: true,
    },
  ];

  it('calcula el total por ítem con IVA según la fórmula de SIIGO', () => {
    const total = calculateSiigoSupportDocumentPaymentValue(
      [
        {
          quantity: 10,
          price: 100,
          discount: 50,
          taxes: [{ id: 1270 }],
        },
      ],
      ivaTaxCatalog,
    );

    expect(total).toBe(1130.5);
  });

  it('suma varios ítems sin usar totales externos', () => {
    const total = calculateSiigoSupportDocumentPaymentValue(
      [
        { quantity: 2, price: 25000 },
        { quantity: 1, price: 80000 },
      ],
      [],
    );

    expect(total).toBe(130000);
  });

  it('mantiene el cálculo de facturas de compra con redondeo a pesos enteros', () => {
    const total = calculateSiigoPurchasePaymentValue(
      [{ quantity: 1, price: 70000, taxes: [{ id: 1270 }] }],
      {
        subtotal: 70000,
        taxAmount: 13300,
      },
    );

    expect(total).toBe(83300);
  });

  it('redondea a pesos enteros en /purchases/send cuando el precio trae decimales reales (caso reportado en producción)', () => {
    // El precio no es un número redondo porque viene de dividir el total
    // real de la factura entre (1 + %IVA) — con roundMoney (2 decimales)
    // da 111176.45 y SIIGO lo rechaza con invalid_total_payments porque su
    // "total purchase calculated" es 111176 (pesos enteros, sin decimales).
    const taxesCatalog = [
      { id: 11792, name: 'IVA 5%', type: 'IVA', percentage: 5, active: true },
    ];

    const totalWithCentsRounding = calculateSiigoSupportDocumentPaymentValue(
      [{ quantity: 1, price: 105882.33, taxes: [{ id: 11792 }] }],
      taxesCatalog,
    );
    expect(totalWithCentsRounding).toBe(111176.45);

    const totalForPurchaseSend = calculateSiigoSupportDocumentPaymentValue(
      [{ quantity: 1, price: 105882.33, taxes: [{ id: 11792 }] }],
      taxesCatalog,
      { roundAmount: roundSiigoAmount },
    );
    expect(totalForPurchaseSend).toBe(111176);
  });

  it('resta Retefuente del valor de pago en documento soporte', () => {
    const taxesCatalog = [
      {
        id: 1287,
        name: 'Retefuente 2.5%',
        type: 'Retefuente',
        percentage: 2.5,
        active: true,
      },
    ];

    const total = calculateSiigoSupportDocumentPaymentValue(
      [{ quantity: 1, price: 100000 }],
      taxesCatalog,
      { retentionIds: [1287] },
    );

    expect(total).toBe(97500);
  });

  it('resta ReteICA expresada en por mil del valor de pago', () => {
    const taxesCatalog = [
      {
        id: 11802,
        name: 'ReteICA',
        type: 'ReteICA',
        percentage: 7.66,
        active: true,
      },
    ];

    const total = calculateSiigoSupportDocumentPaymentValue(
      [{ quantity: 1, price: 150000 }],
      taxesCatalog,
      { retentionIds: [11802] },
    );

    expect(total).toBe(148851);
  });

  it('aplica descuento global en valor absoluto', () => {
    const total = calculateSiigoDocumentPaymentValue(
      [{ quantity: 2, price: 1000 }],
      {
        globalDiscount: 100,
        roundAmount: roundMoney,
      },
    );

    expect(total).toBe(1900);
  });

  it('calcula retenciones sobre el IVA cuando el tipo es ReteIVA', () => {
    const taxesCatalog = [
      {
        id: 1270,
        name: 'IVA 19%',
        type: 'IVA',
        percentage: 19,
        active: true,
      },
      {
        id: 2000,
        name: 'ReteIVA',
        type: 'ReteIVA',
        percentage: 15,
        active: true,
      },
    ];

    const retentionTotal = calculateSiigoDocumentRetentionTotal(
      [{ quantity: 1, price: 100000, taxes: [{ id: 1270 }] }],
      [2000],
      taxesCatalog,
      {
        taxesById: new Map(taxesCatalog.map((tax) => [tax.id, tax])),
        roundAmount: roundMoney,
      },
    );

    expect(retentionTotal).toBe(2850);
  });
});

describe('applySiigoCorrectedPaymentsTotal', () => {
  it('ajusta el único pago al total exacto que SIIGO reportó (caso real: con centavos)', () => {
    const payments = [{ id: 5056, value: 5059932, due_date: '2026-03-06' }];

    const corrected = applySiigoCorrectedPaymentsTotal(payments, 5059932.36);

    expect(corrected).toEqual([
      { id: 5056, value: 5059932.36, due_date: '2026-03-06' },
    ]);
  });

  it('ajusta el único pago a un total exacto en pesos enteros', () => {
    const payments = [{ id: 5056, value: 111176.45 }];

    const corrected = applySiigoCorrectedPaymentsTotal(payments, 111176);

    expect(corrected).toEqual([{ id: 5056, value: 111176 }]);
  });

  it('con varios pagos, solo ajusta el último y deja los demás intactos', () => {
    const payments = [
      { id: 1, value: 40000 },
      { id: 2, value: 30000 },
    ];

    const corrected = applySiigoCorrectedPaymentsTotal(payments, 70050.5);

    expect(corrected).toEqual([
      { id: 1, value: 40000 },
      { id: 2, value: 30050.5 },
    ]);
  });

  it('devuelve el array vacío sin lanzar si no hay pagos', () => {
    expect(applySiigoCorrectedPaymentsTotal([], 100)).toEqual([]);
  });
});
