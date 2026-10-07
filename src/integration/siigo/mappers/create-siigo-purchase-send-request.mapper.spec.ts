import { CreateSiigoPurchaseSendRequestDto } from '../dto/create-siigo-purchase-send.dto';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import { mapCreatePurchaseSendRequestToSiigo } from './create-siigo-purchase-send-request.mapper';

describe('mapCreatePurchaseSendRequestToSiigo', () => {
  it('conserva nueve líneas con IVA y una sin IVA al enviar', () => {
    const request: CreateSiigoPurchaseSendRequestDto = {
      documentId: 'doc-mixto',
      date: '2026-09-28',
      supplier: { identification: '900123456' },
      provider_invoice: { prefix: 'FE', number: '123' },
      items: Array.from({ length: 10 }, (_, index) => ({
        code: '5105', quantity: 1, price: 100,
        ...(index < 9 ? { taxes: [{ id: 19 }] } : {}),
      })),
      payments: [{ id: 1, value: 1171 }],
    };
    const result = mapCreatePurchaseSendRequestToSiigo(request, 1, [
      { id: 19, name: 'IVA 19%', type: 'IVA', percentage: 19, active: true },
    ]);
    expect(result.items.slice(0, 9).every((item) => item.taxes?.[0]?.id === 19)).toBe(true);
    expect(result.items[9].taxes ?? []).toEqual([]);
    expect(result.payments[0].value).toBe(1171);
  });

  it('calcula payments con Redondear a 2 decimales (fórmula documentada por SIIGO)', () => {
    // Caso reportado: price 151176.47 + IVA 19%. Con redondeo a pesos
    // enteros salía 179899 y SIIGO respondía total purchase = 179900.
    const taxesCatalog: SiigoTaxCatalogItemDto[] = [
      { id: 19365, name: 'IVA 19%', type: 'IVA', percentage: 19, active: true },
    ];

    const request: CreateSiigoPurchaseSendRequestDto = {
      documentId: 'doc-cents',
      date: '2026-08-01',
      supplier: { identification: '800242106', branch_office: 0 },
      provider_invoice: { prefix: 'DIAN', number: '90071004585' },
      items: [
        {
          type: 'Account',
          code: '51602001',
          description: 'SOPORTE TV AJUSTABLE',
          quantity: 1,
          price: 151176.47,
          taxes: [{ id: 19365 }],
        },
      ],
      payments: [{ id: 4609, value: 179899 }],
    };

    const siigoPayload = mapCreatePurchaseSendRequestToSiigo(
      request,
      20005,
      taxesCatalog,
    );

    expect(siigoPayload.payments[0].value).toBe(179900);
  });

  it('conserva centavos en payments cuando el precio del ítem tiene decimales (fórmula SIIGO a 2 decimales)', () => {
    // Antes se forzaba peso entero (111176) y en otros casos SIIGO pedía
    // centavos (179900). La fórmula oficial Redondear(..., 2) da 111176.45;
    // si SIIGO en algún tenant pide entero, el reintento de
    // invalid_total_payments corrige el valor.
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

    expect(siigoPayload.payments[0].value).toBe(111176.45);
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
    expect(siigoPayload.payments[0].value).toBe(3742941.67);
  });

  it('trunca observations a 1000 caracteres antes de enviarlo a SIIGO (caso real reportado: boilerplate legal de autorretención ICA de ~5000 caracteres)', () => {
    const taxesCatalog: SiigoTaxCatalogItemDto[] = [];
    const longObservations = 'CUFE: b1794c8ed394 - '.concat('a'.repeat(5000));

    const request: CreateSiigoPurchaseSendRequestDto = {
      documentId: 'doc-3',
      date: '2026-07-06',
      supplier: { identification: '830122566', branch_office: 0 },
      provider_invoice: { prefix: 'BEM', number: '17439170' },
      observations: longObservations,
      items: [
        {
          code: '51356002',
          description: '3166213494 Recarga',
          quantity: 1,
          price: 10000,
        },
      ],
      payments: [{ id: 5056, value: 10000 }],
    };

    const siigoPayload = mapCreatePurchaseSendRequestToSiigo(
      request,
      40779,
      taxesCatalog,
    );

    expect(siigoPayload.observations?.length).toBe(1000);
    expect(siigoPayload.observations?.startsWith('CUFE: b1794c8ed394')).toBe(
      true,
    );
  });

  it('envía Impoconsumo junto con IVA en items[].taxes del body de SIIGO', () => {
    const taxesCatalog: SiigoTaxCatalogItemDto[] = [
      { id: 19, name: 'IVA 19%', type: 'IVA', percentage: 19, active: true },
      {
        id: 40,
        name: 'Impoconsumo 8%',
        type: 'Impoconsumo',
        percentage: 8,
        active: true,
      },
    ];

    const request: CreateSiigoPurchaseSendRequestDto = {
      documentId: 'doc-impoconsumo',
      date: '2026-09-26',
      supplier: { identification: '900123456', branch_office: 0 },
      provider_invoice: { prefix: 'FV', number: '100' },
      items: [
        {
          code: '51050601',
          description: 'Bebida gravada',
          quantity: 1,
          price: 589166.68,
          taxes: [{ id: 19 }, { id: 40 }],
        },
      ],
      payments: [{ id: 5056, value: 695200 }],
    };

    const siigoPayload = mapCreatePurchaseSendRequestToSiigo(
      request,
      40779,
      taxesCatalog,
    );

    expect(siigoPayload.items[0].taxes).toEqual([{ id: 19 }, { id: 40 }]);
  });

  it('envía items[].type FixedAsset cuando la línea es un activo fijo', () => {
    const request: CreateSiigoPurchaseSendRequestDto = {
      documentId: 'doc-activo',
      date: '2026-10-06',
      supplier: { identification: '900123456' },
      provider_invoice: { prefix: 'FE', number: '10' },
      items: [
        {
          type: 'FixedAsset',
          code: 'AF-001',
          description: 'Computador portátil',
          quantity: 1,
          price: 2500000,
        },
      ],
      payments: [{ id: 1, value: 2500000 }],
    };

    const siigoPayload = mapCreatePurchaseSendRequestToSiigo(request, 1, []);

    expect(siigoPayload.items[0].type).toBe('FixedAsset');
    expect(siigoPayload.items[0].code).toBe('AF-001');
  });
});
