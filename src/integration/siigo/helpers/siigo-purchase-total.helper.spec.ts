import {
  calculateSiigoDocumentPaymentValue,
  calculateSiigoDocumentRetentionTotal,
  calculateSiigoPurchasePaymentValue,
  calculateSiigoSupportDocumentPaymentValue,
  roundMoney,
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
