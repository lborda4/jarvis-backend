import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import { SupplierItemAccountMapping } from '../entities/supplier-item-account-mapping.entity';
import { buildSupplierConfigurationKey } from './supplier-accounts-catalog.helper';
import { buildSupplierItemAccountMappingKey } from './supplier-item-account-mapping.helper';
import {
  resolveSuggestedAccountForDocument,
  resolveSuggestedAccountsForDocumentItems,
  resolveSuggestedItemConfigForDocument,
  resolveSuggestedPaymentMethodForDocument,
  resolveSuggestedProductForDocument,
  SupplierDocumentIdentity,
} from './supplier-preferences.helper';

const COMPANY_ID = 'company-1';
const INTEGRATION_ID = 'integration-1';
const SUPPLIER_NIT = '900685902';

const PAYMENT_METHOD = {
  id: 5056,
  name: 'Crédito proveedores',
  type: 'CREDIT',
  dueDate: true,
};

function buildConfigurationIndex(
  configuration: Partial<SupplierConfiguration>,
): Map<string, SupplierConfiguration> {
  const key = buildSupplierConfigurationKey(
    COMPANY_ID,
    INTEGRATION_ID,
    'NIT',
    SUPPLIER_NIT,
  );

  return new Map([[key, configuration as SupplierConfiguration]]);
}

function buildDocument(
  overrides: Partial<SupplierDocumentIdentity> = {},
): SupplierDocumentIdentity {
  return {
    companyId: COMPANY_ID,
    status: ElectronicDocumentStatus.PENDING,
    documentNumberThird: SUPPLIER_NIT,
    payload: {
      supplier: {
        documentNumber: SUPPLIER_NIT,
        documentType: 'NIT',
        name: 'Proveedor de prueba',
      },
      items: [],
    },
    ...overrides,
  };
}

describe('resolveSuggestedItemConfigForDocument', () => {
  it('autocompleta cuando el proveedor ya facturó antes con todos los campos fijos', () => {
    const configurationIndex = buildConfigurationIndex({
      campoVariabilidad: {
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
      },
    });

    const suggestion = resolveSuggestedItemConfigForDocument(
      buildDocument(),
      configurationIndex,
      INTEGRATION_ID,
    );

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

  it('autocompleta la cuenta aunque el medio de pago sea variable (el bug reportado: un campo variable ya no apaga los demás)', () => {
    const configurationIndex = buildConfigurationIndex({
      campoVariabilidad: {
        cuentaPuc: { variable: false, valor: '5135950001' },
        tipoItem: { variable: false, valor: 'Account' },
        medioPago: { variable: true, valor: null },
      },
    });

    const suggestion = resolveSuggestedItemConfigForDocument(
      buildDocument(),
      configurationIndex,
      INTEGRATION_ID,
    );

    expect(suggestion?.accountCode).toBe('5135950001');
    expect(suggestion?.paymentMethod).toBeNull();
  });

  it('deja los campos en null cuando el proveedor repetido tiene config ambigua en todos ellos', () => {
    const configurationIndex = buildConfigurationIndex({
      campoVariabilidad: {
        cuentaPuc: { variable: true, valor: null },
        tipoItem: { variable: false, valor: 'Account' },
      },
    });

    const suggestion = resolveSuggestedItemConfigForDocument(
      buildDocument(),
      configurationIndex,
      INTEGRATION_ID,
    );

    expect(suggestion?.accountCode).toBeNull();
    expect(suggestion?.accountName).toBeNull();
  });

  it('no autocompleta cuando el proveedor es nuevo (sin configuración guardada)', () => {
    expect(
      resolveSuggestedItemConfigForDocument(
        buildDocument(),
        new Map(),
        INTEGRATION_ID,
      ),
    ).toBeNull();
  });

  it('un documento PURCHASE_CREATED sin configuración de envío confirmada (ej. ya existía en SIIGO, detectado por provider_invoice al importar) sí cae al historial del proveedor — bug real reportado: "no me está trayendo la cuenta contable cuando ya está creada en SIIGO"', () => {
    const configurationIndex = buildConfigurationIndex({
      campoVariabilidad: {
        cuentaPuc: { variable: false, valor: '5135950001' },
      },
    });

    const suggestion = resolveSuggestedItemConfigForDocument(
      buildDocument({ status: ElectronicDocumentStatus.PURCHASE_CREATED }),
      configurationIndex,
      INTEGRATION_ID,
    );

    expect(suggestion?.accountCode).toBe('5135950001');
  });

  it('un documento PURCHASE_CREATED CON configuración de envío confirmada (sí se envió desde acá) no sugiere nada genérico encima', () => {
    const configurationIndex = buildConfigurationIndex({
      campoVariabilidad: {
        cuentaPuc: { variable: false, valor: '5135950001' },
      },
    });

    expect(
      resolveSuggestedItemConfigForDocument(
        buildDocument({
          status: ElectronicDocumentStatus.PURCHASE_CREATED,
          payload: {
            supplier: {
              documentNumber: SUPPLIER_NIT,
              documentType: 'NIT',
              name: 'Proveedor de prueba',
            },
            items: [],
            siigoSendConfiguration: {
              account: { code: '5199990001', name: 'Cuenta confirmada' },
              retentions: [],
            },
          },
        }),
        configurationIndex,
        INTEGRATION_ID,
      ),
    ).toBeNull();
  });
});

describe('resolveSuggestedProductForDocument', () => {
  it('devuelve la sugerencia de producto de la clasificación con IA (aiSuggestion.product)', () => {
    const document = buildDocument({
      payload: {
        supplier: {
          documentNumber: SUPPLIER_NIT,
          documentType: 'NIT',
          name: 'Proveedor de prueba',
        },
        items: [],
        aiSuggestion: {
          product: { code: 'PROD-001', name: 'Producto de prueba' },
          retentions: [],
        },
      },
    });

    expect(resolveSuggestedProductForDocument(document)).toEqual({
      code: 'PROD-001',
      name: 'Producto de prueba',
    });
  });

  it('devuelve null cuando la clasificación con IA sugirió cuenta en vez de producto', () => {
    const document = buildDocument({
      payload: {
        supplier: {
          documentNumber: SUPPLIER_NIT,
          documentType: 'NIT',
          name: 'Proveedor de prueba',
        },
        items: [],
        aiSuggestion: {
          account: { code: '51356001', name: 'Servicio internet' },
          retentions: [],
        },
      },
    });

    expect(resolveSuggestedProductForDocument(document)).toBeNull();
  });

  it('devuelve null cuando no hay sugerencia de IA', () => {
    expect(resolveSuggestedProductForDocument(buildDocument())).toBeNull();
  });
});

describe('resolveSuggestedPaymentMethodForDocument', () => {
  it('prioriza el medio de pago dominante del sync sobre la preferencia manual guardada', () => {
    const configurationIndex = buildConfigurationIndex({
      campoVariabilidad: {
        medioPago: { variable: false, valor: PAYMENT_METHOD },
      },
      preference: {
        account: { code: '5135950001', name: '5135950001' },
        paymentMethod: { id: 1, name: 'Efectivo', type: 'CASH' },
        retentions: [],
      },
    });

    const suggestion = resolveSuggestedPaymentMethodForDocument(
      buildDocument(),
      configurationIndex,
      INTEGRATION_ID,
    );

    expect(suggestion).toEqual(PAYMENT_METHOD);
  });

  it('cae a la preferencia manual guardada cuando el medio de pago del proveedor es variable (sin fijo del sync)', () => {
    const configurationIndex = buildConfigurationIndex({
      campoVariabilidad: {
        medioPago: { variable: true, valor: null },
      },
      preference: {
        account: { code: '5135950001', name: '5135950001' },
        paymentMethod: { id: 1, name: 'Efectivo', type: 'CASH' },
        retentions: [],
      },
    });

    const suggestion = resolveSuggestedPaymentMethodForDocument(
      buildDocument(),
      configurationIndex,
      INTEGRATION_ID,
    );

    expect(suggestion).toEqual({ id: 1, name: 'Efectivo', type: 'CASH' });
  });

  it('no sugiere nada cuando el proveedor es nuevo (sin configuración guardada)', () => {
    expect(
      resolveSuggestedPaymentMethodForDocument(
        buildDocument(),
        new Map(),
        INTEGRATION_ID,
      ),
    ).toBeNull();
  });
});

function buildItemMappingIndex(
  mappings: Array<Partial<SupplierItemAccountMapping>>,
): Map<string, SupplierItemAccountMapping> {
  const index = new Map<string, SupplierItemAccountMapping>();

  for (const mapping of mappings) {
    const key = buildSupplierItemAccountMappingKey(
      COMPANY_ID,
      INTEGRATION_ID,
      'NIT',
      SUPPLIER_NIT,
      mapping.descriptionOriginal ?? '',
    );

    index.set(key, mapping as SupplierItemAccountMapping);
  }

  return index;
}

describe('resolveSuggestedAccountForDocument — PURCHASE_CREATED', () => {
  it('un documento PURCHASE_CREATED sin configuración de envío confirmada cae a la sugerencia de IA en vez de quedar vacío', () => {
    const document = buildDocument({
      status: ElectronicDocumentStatus.PURCHASE_CREATED,
      payload: {
        supplier: {
          documentNumber: SUPPLIER_NIT,
          documentType: 'NIT',
          name: 'Proveedor de prueba',
        },
        items: [],
        aiSuggestion: {
          account: { code: '51356001', name: 'Servicio internet' },
          retentions: [],
        },
      },
    });

    expect(
      resolveSuggestedAccountForDocument(document, new Map(), new Map(), INTEGRATION_ID),
    ).toEqual({ code: '51356001', name: 'Servicio internet', uses: 1 });
  });

  it('un documento PURCHASE_CREATED con configuración de envío confirmada usa esa cuenta, no la de IA', () => {
    const document = buildDocument({
      status: ElectronicDocumentStatus.PURCHASE_CREATED,
      payload: {
        supplier: {
          documentNumber: SUPPLIER_NIT,
          documentType: 'NIT',
          name: 'Proveedor de prueba',
        },
        items: [],
        siigoSendConfiguration: {
          account: { code: '5199990001', name: 'Cuenta confirmada' },
          retentions: [],
        },
        aiSuggestion: {
          account: { code: '51356001', name: 'Servicio internet' },
          retentions: [],
        },
      },
    });

    expect(
      resolveSuggestedAccountForDocument(document, new Map(), new Map(), INTEGRATION_ID),
    ).toEqual({ code: '5199990001', name: 'Cuenta confirmada', uses: 1 });
  });
});

describe('resolveSuggestedAccountsForDocumentItems / resolveSuggestedAccountForDocument', () => {
  // Caso real: un proveedor de telecomunicaciones factura tres conceptos,
  // cada uno consistente en su propia cuenta — antes se marcaba "variable"
  // a nivel proveedor y se perdía la sugerencia para los tres.
  it('resuelve cada ítem por su propia regla exacta, no por la cuenta dominante del proveedor', () => {
    const configurationIndex = buildConfigurationIndex({
      preference: {
        account: { code: '51356001', name: 'Servicio internet' },
        retentions: [],
      },
    });
    const itemMappingIndex = buildItemMappingIndex([
      {
        descriptionOriginal: 'Servicio internet',
        accountCode: '51356001',
        accountName: 'Servicio internet',
      },
      {
        descriptionOriginal: 'Servicio Linea Telefonica',
        accountCode: '51356002',
        accountName: 'Servicio Línea Telefónica',
      },
    ]);
    const document = buildDocument({
      payload: {
        supplier: {
          documentNumber: SUPPLIER_NIT,
          documentType: 'NIT',
          name: 'Proveedor de prueba',
        },
        items: [
          { descripcion: 'Servicio internet' },
          { descripcion: 'Servicio Linea Telefonica' },
          { descripcion: 'Oferta suplementaria D' },
        ] as never,
      },
    });

    const perItem = resolveSuggestedAccountsForDocumentItems(
      document,
      configurationIndex,
      itemMappingIndex,
      INTEGRATION_ID,
    );

    expect(perItem[0]).toEqual({
      code: '51356001',
      name: 'Servicio internet',
      source: 'exact',
    });
    expect(perItem[1]).toEqual({
      code: '51356002',
      name: 'Servicio Línea Telefónica',
      source: 'exact',
    });
    // Descripción nueva, sin regla exacta: cae al fallback de proveedor,
    // marcada explícitamente como sugerencia, no como confirmada.
    expect(perItem[2]).toEqual({
      code: '51356001',
      name: 'Servicio internet',
      source: 'fallback',
    });
  });

  it('la columna-resumen del documento devuelve null cuando los ítems tienen cuentas distintas', () => {
    const configurationIndex = buildConfigurationIndex({
      preference: {
        account: { code: '51356001', name: 'Servicio internet' },
        retentions: [],
      },
    });
    const itemMappingIndex = buildItemMappingIndex([
      {
        descriptionOriginal: 'Servicio internet',
        accountCode: '51356001',
        accountName: 'Servicio internet',
      },
      {
        descriptionOriginal: 'Servicio Linea Telefonica',
        accountCode: '51356002',
        accountName: 'Servicio Línea Telefónica',
      },
    ]);
    const document = buildDocument({
      payload: {
        supplier: {
          documentNumber: SUPPLIER_NIT,
          documentType: 'NIT',
          name: 'Proveedor de prueba',
        },
        items: [
          { descripcion: 'Servicio internet' },
          { descripcion: 'Servicio Linea Telefonica' },
        ] as never,
      },
    });

    expect(
      resolveSuggestedAccountForDocument(
        document,
        configurationIndex,
        itemMappingIndex,
        INTEGRATION_ID,
      ),
    ).toBeNull();
  });

  it('la columna-resumen del documento sí devuelve la cuenta cuando todos los ítems coinciden', () => {
    const configurationIndex = buildConfigurationIndex({
      preference: {
        account: { code: '51356001', name: 'Servicio internet' },
        retentions: [],
      },
    });
    const itemMappingIndex = buildItemMappingIndex([
      {
        descriptionOriginal: 'Servicio internet',
        accountCode: '51356001',
        accountName: 'Servicio internet',
      },
    ]);
    const document = buildDocument({
      payload: {
        supplier: {
          documentNumber: SUPPLIER_NIT,
          documentType: 'NIT',
          name: 'Proveedor de prueba',
        },
        items: [
          { descripcion: 'Servicio internet' },
          { descripcion: 'Servicio internet' },
        ] as never,
      },
    });

    expect(
      resolveSuggestedAccountForDocument(
        document,
        configurationIndex,
        itemMappingIndex,
        INTEGRATION_ID,
      ),
    ).toEqual({ code: '51356001', name: 'Servicio internet', uses: 1 });
  });
});
