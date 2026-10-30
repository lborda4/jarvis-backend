import { assertPurchaseConsumptionTax } from './siigo-purchase-consumption.helper';
import { mapElectronicDocumentToSiigoPurchase } from '../mappers/electronic-document-to-siigo-purchase.mapper';
import { mapCreatePurchaseSendRequestToSiigo } from '../mappers/create-siigo-purchase-send-request.mapper';
import type { ElectronicDocumentPayload } from '../../../electronic-document/interfaces/electronic-document-payload.interface';

const catalog = [
  { id: 108, name: 'Impoconsumo 8%', type: 'Impoconsumo', percentage: 8, active: true },
  { id: 119, name: 'IVA 19%', type: 'IVA', percentage: 19, active: true },
];
const payload = {
  supplier: { documentNumber: '900123456' }, invoice: { number: 'FE123', issueDate: '2026-10-29', cufe: 'test-cufe' },
  items: [{ descripcion: 'Servicio', cantidad: 1, valorUnitario: 100000, total: 100000, consumptionTaxPercentage: 8, accountMapping: { code: '5135' } }],
  taxes: [{ type: 'INC', amount: 8000 }], totals: { subtotal: 100000, iva: 0, total: 108000 },
} as ElectronicDocumentPayload;
describe('impoconsumo de compras SIIGO', () => {
  it('bloquea una compra con INC si el cliente omitió el impuesto', () => {
    expect(() => assertPurchaseConsumptionTax(payload, [{ taxes: [{ id: 119 }] }], catalog)).toThrow('impoconsumo');
  });
  it('acepta el identificador de INC y rechaza uno inactivo', () => {
    expect(() => assertPurchaseConsumptionTax(payload, [{ taxes: [{ id: 108 }] }], catalog)).not.toThrow();
    expect(() => assertPurchaseConsumptionTax(payload, [{ taxes: [{ id: 108 }] }], [{ ...catalog[0], active: false }])).toThrow('impoconsumo');
  });
  it('la creación automática manda INC y suma su importe al pago', () => {
    const result = mapElectronicDocumentToSiigoPurchase(payload, { documentId: 1, defaultTaxId: 119, paymentTypeId: 2 }, { taxesCatalog: catalog });
    expect(result.items[0].taxes).toEqual([{ id: 108 }]);
    expect(result.payments[0].value).toBe(108000);
  });
  it('no inventa un impuesto si no existe en el catálogo', () => {
    expect(() => mapElectronicDocumentToSiigoPurchase(payload, { documentId: 1, defaultTaxId: 119, paymentTypeId: 2 }, { taxesCatalog: [] })).toThrow('impoconsumo');
  });
  it('el envío manual conserva IVA e INC y calcula ambos sobre la base descontada', () => {
    const result = mapCreatePurchaseSendRequestToSiigo({ documentId: 'doc', date: '2026-10-29', supplier: { identification: '900123456' }, provider_invoice: { prefix: 'FE', number: '123' }, items: [{ code: '5135', quantity: 1, price: 100000, discount: 10000, taxes: [{ id: 119 }, { id: 108 }] }], payments: [{ id: 2, value: 114300 }] }, 1, catalog);
    expect(result.items[0].taxes).toEqual([{ id: 119 }, { id: 108 }]);
    expect(result.payments[0].value).toBe(114300);
  });
});

it('no incluye INC en la base de ReteIVA', () => {
  const result = mapCreatePurchaseSendRequestToSiigo({ documentId: 'doc', date: '2026-10-29', supplier: { identification: '900123456' }, provider_invoice: { prefix: 'FE', number: '123' }, items: [{ code: '5135', quantity: 1, price: 100000, taxes: [{ id: 119 }, { id: 108 }] }], retentions: [{ id: 215 }], payments: [{ id: 2, value: 124150 }] }, 1, [...catalog, { id: 215, name: 'ReteIVA 15%', type: 'ReteIVA', percentage: 15, active: true }]);
  expect(result.payments[0].value).toBe(124150);
});
