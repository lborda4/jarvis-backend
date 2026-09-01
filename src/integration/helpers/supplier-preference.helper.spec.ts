import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import { SupplierFieldVariability } from '../interfaces/supplier-field-variability.interface';
import {
  resolveSuggestedAccountForItem,
  resolveSuggestedItemConfigFromConfiguration,
  resolveSuggestedPaymentMethodFromSync,
  resolveSuggestedRetentionsFromSync,
} from './supplier-preference.helper';

type ConfigInput = Pick<SupplierConfiguration, 'campoVariabilidad'>;

const PAYMENT_METHOD = {
  id: 5056,
  name: 'Crédito proveedores',
  type: 'CREDIT',
  dueDate: true,
};

function buildConfiguration(
  overrides: Partial<SupplierFieldVariability> = {},
): ConfigInput {
  const campoVariabilidad: SupplierFieldVariability = {
    cuentaPuc: { variable: false, valor: '5135950001' },
    tipoItem: { variable: false, valor: 'Account' },
    medioPago: { variable: false, valor: PAYMENT_METHOD },
    iva: {
      variable: false,
      valor: { id: 1, name: 'IVA 19%', percentage: 19 },
    },
    retefuente: {
      variable: false,
      valor: { id: 4, name: 'Servicios 4%', percentage: 4 },
    },
    ...overrides,
  };

  return { campoVariabilidad };
}

describe('resolveSuggestedItemConfigFromConfiguration', () => {
  it('autocompleta cada campo de forma independiente cuando todos son fijos', () => {
    const suggestion =
      resolveSuggestedItemConfigFromConfiguration(buildConfiguration());

    expect(suggestion).toEqual({
      itemType: 'Account',
      accountCode: '5135950001',
      accountName: '5135950001',
      productCode: null,
      productName: null,
      ivaTax: { id: 1, name: 'IVA 19%', percentage: 19 },
      retefuenteTax: { id: 4, name: 'Servicios 4%', percentage: 4 },
      paymentMethod: PAYMENT_METHOD,
    });
  });

  it('mapea itemType=Product cuando ese es el tipo dominante, exponiendo el código dominante como productCode (no accountCode)', () => {
    const suggestion = resolveSuggestedItemConfigFromConfiguration(
      buildConfiguration({
        tipoItem: { variable: false, valor: 'Product' },
      }),
    );

    expect(suggestion?.itemType).toBe('Product');
    expect(suggestion?.productCode).toBe('5135950001');
    expect(suggestion?.productName).toBe('5135950001');
    expect(suggestion?.accountCode).toBeNull();
    expect(suggestion?.accountName).toBeNull();
  });

  it('no aplica el filtro de forma de cuenta PUC (isAllowedAccountCode) a un código dominante de tipo Producto', () => {
    const suggestion = resolveSuggestedItemConfigFromConfiguration(
      buildConfiguration({
        tipoItem: { variable: false, valor: 'Product' },
        cuentaPuc: { variable: false, valor: 'SKU-001' },
      }),
    );

    expect(suggestion?.productCode).toBe('SKU-001');
  });

  it('deja solo el medio de pago en null cuando ese campo es variable, sin apagar cuenta ni impuestos', () => {
    const suggestion = resolveSuggestedItemConfigFromConfiguration(
      buildConfiguration({ medioPago: { variable: true, valor: null } }),
    );

    expect(suggestion).toEqual({
      itemType: 'Account',
      accountCode: '5135950001',
      accountName: '5135950001',
      productCode: null,
      productName: null,
      ivaTax: { id: 1, name: 'IVA 19%', percentage: 19 },
      retefuenteTax: { id: 4, name: 'Servicios 4%', percentage: 4 },
      paymentMethod: null,
    });
  });

  it('deja solo la cuenta en null cuando ese campo es variable, sin apagar el resto', () => {
    const suggestion = resolveSuggestedItemConfigFromConfiguration(
      buildConfiguration({ cuentaPuc: { variable: true, valor: null } }),
    );

    expect(suggestion?.accountCode).toBeNull();
    expect(suggestion?.accountName).toBeNull();
    expect(suggestion?.paymentMethod).toEqual(PAYMENT_METHOD);
  });

  it('ignora una cuenta dominante en el historial que no es clase 5/6/7 (basura heredada, ej. "1"), en vez de autocompletarla', () => {
    const suggestion = resolveSuggestedItemConfigFromConfiguration(
      buildConfiguration({ cuentaPuc: { variable: false, valor: '1' } }),
    );

    expect(suggestion?.accountCode).toBeNull();
    expect(suggestion?.accountName).toBeNull();
    expect(suggestion?.paymentMethod).toEqual(PAYMENT_METHOD);
  });

  it('no autocompleta ningún campo cuando no hay proveedor guardado (tercero nuevo)', () => {
    expect(resolveSuggestedItemConfigFromConfiguration(null)).toBeNull();
    expect(resolveSuggestedItemConfigFromConfiguration(undefined)).toBeNull();
  });

  it('deja los campos en null cuando el proveedor nunca se sincronizó (sin campoVariabilidad)', () => {
    const suggestion = resolveSuggestedItemConfigFromConfiguration({
      campoVariabilidad: null,
    });

    expect(suggestion).toEqual({
      itemType: null,
      accountCode: null,
      accountName: null,
      productCode: null,
      productName: null,
      ivaTax: null,
      retefuenteTax: null,
      paymentMethod: null,
    });
  });

  it('deja los impuestos en null si el historial nunca calculó IVA o Retefuente para ese proveedor', () => {
    const suggestion = resolveSuggestedItemConfigFromConfiguration(
      buildConfiguration({ iva: undefined, retefuente: undefined }),
    );

    expect(suggestion?.ivaTax).toBeNull();
    expect(suggestion?.retefuenteTax).toBeNull();
  });
});

describe('resolveSuggestedPaymentMethodFromSync', () => {
  it('sugiere el medio de pago dominante cuando ese campo es fijo', () => {
    expect(resolveSuggestedPaymentMethodFromSync(buildConfiguration())).toEqual(
      PAYMENT_METHOD,
    );
  });

  it('no sugiere cuando el medio de pago es variable, aunque cuenta sea fija', () => {
    expect(
      resolveSuggestedPaymentMethodFromSync(
        buildConfiguration({ medioPago: { variable: true, valor: null } }),
      ),
    ).toBeNull();
  });

  it('no sugiere cuando el campo nunca se calculó (proveedor sin historial de medio de pago)', () => {
    expect(
      resolveSuggestedPaymentMethodFromSync(
        buildConfiguration({ medioPago: undefined }),
      ),
    ).toBeNull();
  });

  it('no sugiere cuando no hay proveedor guardado (tercero nuevo)', () => {
    expect(resolveSuggestedPaymentMethodFromSync(null)).toBeNull();
    expect(resolveSuggestedPaymentMethodFromSync(undefined)).toBeNull();
  });
});

describe('resolveSuggestedRetentionsFromSync', () => {
  it('arma las retenciones a partir de las categorías fijas (Retefuente/ReteICA/Autorretención), sin incluir IVA', () => {
    const retentions = resolveSuggestedRetentionsFromSync(
      buildConfiguration({
        reteica: {
          variable: false,
          valor: { id: 7, name: 'ReteICA 1%', percentage: 1 },
        },
      }),
    );

    expect(retentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 4, percentage: 4 }),
        expect.objectContaining({ id: 7, percentage: 1 }),
      ]),
    );
  });

  it('excluye una categoría de retención cuando es variable, sin afectar las demás', () => {
    const retentions = resolveSuggestedRetentionsFromSync(
      buildConfiguration({
        retefuente: { variable: true, valor: null },
        reteica: {
          variable: false,
          valor: { id: 7, name: 'ReteICA 1%', percentage: 1 },
        },
      }),
    );

    expect(retentions?.some((retention) => retention.id === 4)).toBe(false);
    expect(retentions?.some((retention) => retention.id === 7)).toBe(true);
  });

  it('retorna null cuando el proveedor nunca calculó ninguna categoría de retención', () => {
    expect(
      resolveSuggestedRetentionsFromSync({ campoVariabilidad: null }),
    ).toBeNull();
    expect(resolveSuggestedRetentionsFromSync(null)).toBeNull();
    expect(resolveSuggestedRetentionsFromSync(undefined)).toBeNull();
  });
});

describe('resolveSuggestedAccountForItem', () => {
  // Caso real reportado: un proveedor de telecomunicaciones factura varios
  // conceptos, cada uno 100% consistente en su propia cuenta — la regla
  // exacta de ESTE ítem debe ganar aunque el proveedor tenga otra cuenta
  // "dominante" distinta en su fallback.
  it('usa la regla exacta (proveedor + descripción) cuando existe, aunque difiera del fallback de proveedor', () => {
    const itemMapping = {
      accountCode: '51356002',
      accountName: 'Servicio Línea Telefónica',
    };
    const configuration = {
      preference: {
        account: { code: '51356001', name: 'Servicio internet' },
        retentions: [],
      },
    };

    const result = resolveSuggestedAccountForItem(itemMapping, configuration);

    expect(result).toEqual({
      code: '51356002',
      name: 'Servicio Línea Telefónica',
      source: 'exact',
    });
  });

  it('cae al fallback de proveedor marcado como sugerencia cuando la descripción es nueva', () => {
    const configuration = {
      preference: {
        account: { code: '51356001', name: 'Servicio internet' },
        retentions: [],
      },
    };

    const result = resolveSuggestedAccountForItem(null, configuration);

    expect(result).toEqual({
      code: '51356001',
      name: 'Servicio internet',
      source: 'fallback',
    });
  });

  it('retorna null cuando no hay regla exacta ni fallback de proveedor', () => {
    expect(resolveSuggestedAccountForItem(null, null)).toBeNull();
    expect(resolveSuggestedAccountForItem(undefined, undefined)).toBeNull();
  });
});
