import {
  resolveCreditFallbackPaymentMethod,
  resolvePurchaseCreditFallbackPaymentMethod,
} from './siigo-credit-payment-method.helper';
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

describe('resolvePurchaseCreditFallbackPaymentMethod', () => {
  const catalog: SiigoPaymentTypeCatalogItemDto[] = [
    { id: 10, name: 'Efectivo', type: 'Cash', dueDate: false, documentType: 'FC' },
    {
      id: 9187,
      name: 'Crédito proveedores',
      type: 'Credit',
      dueDate: true,
      documentType: 'FC',
    },
    {
      id: 9188,
      name: 'Otras cuentas por pagar',
      type: 'Credit',
      dueDate: true,
      documentType: 'FC',
    },
  ];

  it('cuenta clase 5 usa Otras cuentas por pagar', () => {
    expect(
      resolvePurchaseCreditFallbackPaymentMethod('51359501', catalog),
    ).toEqual({
      id: 9188,
      name: 'Otras cuentas por pagar',
      type: 'Credit',
      dueDate: true,
    });
  });

  it.each(['11050501', '61350501', '71050501', null])(
    'cuenta %s usa Crédito proveedores',
    (accountCode) => {
      expect(
        resolvePurchaseCreditFallbackPaymentMethod(accountCode, catalog),
      ).toEqual({
        id: 9187,
        name: 'Crédito proveedores',
        type: 'Credit',
        dueDate: true,
      });
    },
  );

  it('si no encuentra el nombre, usa el primer medio a crédito del catálogo', () => {
    const catalogWithoutNames: SiigoPaymentTypeCatalogItemDto[] = [
      { id: 1, name: 'Efectivo', type: 'Cash', dueDate: false, documentType: 'FC' },
      { id: 2, name: 'Crédito 30 días', type: 'Credit', dueDate: true, documentType: 'FC' },
    ];

    expect(
      resolvePurchaseCreditFallbackPaymentMethod('5135', catalogWithoutNames),
    ).toEqual({
      id: 2,
      name: 'Crédito 30 días',
      type: 'Credit',
      dueDate: true,
    });
  });
});
