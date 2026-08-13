import { CreateSiigoPurchaseSendRequestDto } from '../dto/create-siigo-purchase-send.dto';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import { mapCreatePurchaseSendRequestToSiigo } from './create-siigo-purchase-send-request.mapper';

describe('mapCreatePurchaseSendRequestToSiigo', () => {
  it('redondea payments[0].value a pesos enteros aunque el precio del ítem tenga decimales reales', () => {
    // Mismo caso reportado en producción: item.price = 105882.33 con IVA
    // 5% da 111176.45 con redondeo a centavos, pero SIIGO valida
    // /v1/purchases contra un total en pesos enteros (111176) y rechaza
    // cualquier otro valor con invalid_total_payments.
    const taxesCatalog: SiigoTaxCatalogItemDto[] = [
      { id: 11792, name: 'IVA 5%', type: 'IVA', percentage: 5, active: true },
    ];

    const request: CreateSiigoPurchaseSendRequestDto = {
      documentId: 'doc-1',
      date: '2026-08-12',
      supplier: { identification: '51952814', branch_office: 0 },
      provider_invoice: { prefix: 'PDI', number: '6518' },
      items: [
        {
          code: '51051501',
          description: 'Factura electrónica recibida',
          quantity: 1,
          price: 105882.33,
          taxes: [{ id: 11792 }],
        },
      ],
      payments: [{ id: 9187, value: 111176.45 }],
    };

    const siigoPayload = mapCreatePurchaseSendRequestToSiigo(
      request,
      40779,
      taxesCatalog,
    );

    expect(siigoPayload.payments[0].value).toBe(111176);
    expect(Number.isInteger(siigoPayload.payments[0].value)).toBe(true);
  });

  it('limpia el residuo de punto flotante de items[].price antes de enviarlo a SIIGO', () => {
    // Otro caso reportado en producción: el precio importado desde
    // NextPyme/DIAN llega como 3564706.3499999996 (residuo de punto
    // flotante) y SIIGO lo rechaza con invalid_amount por tener más de 2
    // decimales.
    const taxesCatalog: SiigoTaxCatalogItemDto[] = [
      { id: 11792, name: 'IVA 5%', type: 'IVA', percentage: 5, active: true },
    ];

    const request: CreateSiigoPurchaseSendRequestDto = {
      documentId: 'doc-2',
      date: '2026-08-12',
      supplier: { identification: '811029191', branch_office: 0 },
      provider_invoice: { prefix: 'FEVE', number: '108282' },
      items: [
        {
          code: '51051501',
          description: 'Factura electrónica recibida',
          quantity: 1,
          price: 3564706.3499999996,
          taxes: [{ id: 11792 }],
        },
      ],
      payments: [{ id: 9187, value: 3742941 }],
    };

    const siigoPayload = mapCreatePurchaseSendRequestToSiigo(
      request,
      40779,
      taxesCatalog,
    );

    expect(siigoPayload.items[0].price).toBe(3564706.35);
    expect(siigoPayload.payments[0].value).toBe(3742941);
  });
});
