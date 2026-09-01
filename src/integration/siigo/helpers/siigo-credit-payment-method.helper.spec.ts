import { resolveCreditFallbackPaymentMethod } from './siigo-credit-payment-method.helper';
import { SiigoPaymentTypeCatalogItemDto } from '../dto/list-siigo-payment-types.dto';

describe('resolveCreditFallbackPaymentMethod', () => {
  const catalog: SiigoPaymentTypeCatalogItemDto[] = [
    { id: 1, name: 'Efectivo', type: 'Cash', dueDate: false, documentType: 'FC' },
    { id: 2, name: 'Transferencia a 30 días', type: 'Cheque', dueDate: true, documentType: 'FC' },
  ];

  it('sugiere el único medio de pago de contado cuando isCreditPayment=false', () => {
    const result = resolveCreditFallbackPaymentMethod(false, catalog);

    expect(result).toEqual({ id: 1, name: 'Efectivo', type: 'Cash', dueDate: false });
  });

  it('sugiere el único medio de pago de crédito cuando isCreditPayment=true', () => {
    const result = resolveCreditFallbackPaymentMethod(true, catalog);

    expect(result).toEqual({
      id: 2,
      name: 'Transferencia a 30 días',
      type: 'Cheque',
      dueDate: true,
    });
  });

  it('no sugiere nada si isCreditPayment es desconocido', () => {
    expect(resolveCreditFallbackPaymentMethod(undefined, catalog)).toBeNull();
  });

  it('no sugiere nada si hay más de un medio de pago del tipo correspondiente', () => {
    const catalogWithTwoCash: SiigoPaymentTypeCatalogItemDto[] = [
      ...catalog,
      { id: 3, name: 'Efectivo caja menor', type: 'Cash', dueDate: false, documentType: 'FC' },
    ];

    expect(resolveCreditFallbackPaymentMethod(false, catalogWithTwoCash)).toBeNull();
  });

  it('no sugiere nada si no hay ninguno del tipo correspondiente', () => {
    const onlyCash: SiigoPaymentTypeCatalogItemDto[] = [
      { id: 1, name: 'Efectivo', type: 'Cash', dueDate: false, documentType: 'FC' },
    ];

    expect(resolveCreditFallbackPaymentMethod(true, onlyCash)).toBeNull();
  });
});
