import {
  assertSendAccountCodesExistInCatalog,
  buildAccountNameByCode,
  collectPickerAccountsCatalog,
  collectUniqueAccountsCatalog,
  resolveAccountNameFromCatalog,
  resolveCatalogBoundAccountSuggestion,
  resolveRequiredAccountFromCatalog,
} from './supplier-accounts-catalog.helper';

describe('buildAccountNameByCode', () => {
  it('mapea código a nombre real desde el catálogo de SIIGO', () => {
    const map = buildAccountNameByCode([
      { code: '71050511', name: 'EMPAQUES/BOLSAS' },
      {
        code: '51952001',
        name: 'Gastos de representación y relaciones publicas',
      },
    ]);

    expect(map.get('71050511')).toBe('EMPAQUES/BOLSAS');
    expect(map.get('51952001')).toBe(
      'Gastos de representación y relaciones publicas',
    );
  });

  it('recorta espacios y descarta entradas sin código o sin nombre', () => {
    const map = buildAccountNameByCode([
      { code: ' 71050511 ', name: ' EMPAQUES/BOLSAS ' },
      { code: '', name: 'Sin código' },
      { code: '61350596', name: '' },
    ]);

    expect(map.get('71050511')).toBe('EMPAQUES/BOLSAS');
    expect(map.has('')).toBe(false);
    expect(map.has('61350596')).toBe(false);
  });
});

describe('resolveAccountNameFromCatalog', () => {
  // Bug real reportado en producción: una sugerencia "aprendida" del
  // historial de compras (o de una regla item-level sin nombre real
  // guardado) solo conoce el CÓDIGO de la cuenta y usaba ese código como si
  // fuera el nombre — la UI terminaba mostrando "71050511 - 71050511" en
  // vez de "71050511 - EMPAQUES/BOLSAS". El catálogo real de SIIGO SIEMPRE
  // debe ganar sobre ese fallback.
  it('usa el nombre real del catálogo aunque el fallback sea el código repetido', () => {
    const catalog = buildAccountNameByCode([
      { code: '71050511', name: 'EMPAQUES/BOLSAS' },
    ]);

    const result = resolveAccountNameFromCatalog(
      '71050511',
      '71050511', // fallback contaminado: nombre = código
      catalog,
    );

    expect(result).toBe('EMPAQUES/BOLSAS');
  });

  it('cae al fallback cuando el código no existe en el catálogo (cuenta borrada/nueva)', () => {
    const catalog = buildAccountNameByCode([
      { code: '71050511', name: 'EMPAQUES/BOLSAS' },
    ]);

    expect(
      resolveAccountNameFromCatalog('99999999', 'Cuenta sin catálogo', catalog),
    ).toBe('Cuenta sin catálogo');
    expect(resolveAccountNameFromCatalog('99999999', null, catalog)).toBeNull();
  });

  it('recorta espacios en el código antes de buscar en el catálogo', () => {
    const catalog = buildAccountNameByCode([
      { code: '71050511', name: 'EMPAQUES/BOLSAS' },
    ]);

    expect(
      resolveAccountNameFromCatalog(' 71050511 ', '71050511', catalog),
    ).toBe('EMPAQUES/BOLSAS');
  });
});

describe('resolveCatalogBoundAccountSuggestion', () => {
  it('descarta códigos que ya no están en el catálogo usable', () => {
    const catalog = buildAccountNameByCode([
      { code: '71050511', name: 'EMPAQUES/BOLSAS' },
    ]);

    expect(
      resolveCatalogBoundAccountSuggestion(
        { code: '99999999', name: 'Cuenta borrada' },
        catalog,
      ),
    ).toBeNull();
  });

  it('usa el nombre real del catálogo cuando el código sí existe', () => {
    const catalog = buildAccountNameByCode([
      { code: '71050511', name: 'EMPAQUES/BOLSAS' },
    ]);

    expect(
      resolveCatalogBoundAccountSuggestion(
        { code: '71050511', name: '71050511' },
        catalog,
      ),
    ).toEqual({ code: '71050511', name: 'EMPAQUES/BOLSAS' });
  });
});

describe('assertSendAccountCodesExistInCatalog', () => {
  const catalog = [{ code: '51451001', name: 'Gastos' }];

  it('rechaza cuentas Account fuera del catálogo', () => {
    expect(() =>
      assertSendAccountCodesExistInCatalog(
        [{ type: 'Account', code: '99999999' }],
        catalog,
      ),
    ).toThrow(/no existe en el plan de cuentas/);
  });

  it('acepta cuentas presentes en el catálogo', () => {
    expect(() =>
      assertSendAccountCodesExistInCatalog(
        [{ type: 'Account', code: '51451001' }],
        catalog,
      ),
    ).not.toThrow();
  });

  it('no valida códigos de Product (no son cuentas PUC)', () => {
    expect(() =>
      assertSendAccountCodesExistInCatalog(
        [{ type: 'Product', code: 'PROD-1' }],
        catalog,
      ),
    ).not.toThrow();
  });
});

describe('resolveRequiredAccountFromCatalog', () => {
  it('usa el código preferido si existe en el catálogo', () => {
    expect(
      resolveRequiredAccountFromCatalog(
        [
          { code: '51050601', name: 'Aseo' },
          { code: '51959501', name: 'Diversos' },
        ],
        ['51959501'],
      ),
    ).toEqual({ code: '51959501', name: 'Diversos' });
  });

  it('cae a la primera cuenta del catálogo si ningún código preferido existe', () => {
    expect(
      resolveRequiredAccountFromCatalog(
        [
          { code: '51050601', name: 'Aseo' },
          { code: '51959501', name: 'Diversos' },
        ],
        [null, 'NO-EXISTE'],
      ),
    ).toEqual({ code: '51050601', name: 'Aseo' });
  });

  it('devuelve null solo si el catálogo está vacío', () => {
    expect(resolveRequiredAccountFromCatalog([], ['51959501'])).toBeNull();
  });
});

describe('collectPickerAccountsCatalog', () => {
  it('incluye cuentas transaccionales de cualquier clase PUC, no solo 5/6/7', () => {
    expect(
      collectPickerAccountsCatalog([
        { code: '11050501', name: 'Caja general', isTransactional: true },
        { code: '22050501', name: 'Proveedores', isTransactional: true },
        { code: '41350501', name: 'Ingresos', isTransactional: true },
        { code: '51050601', name: 'Aseo', isTransactional: true },
        { code: '61350501', name: 'Costo de ventas', isTransactional: true },
        { code: '71050511', name: 'Empaques', isTransactional: true },
      ]).map((account) => account.code),
    ).toEqual([
      '11050501',
      '22050501',
      '41350501',
      '51050601',
      '61350501',
      '71050511',
    ]);
  });

  it('sigue excluyendo padres no transaccionales', () => {
    expect(
      collectPickerAccountsCatalog([
        { code: '11', name: 'Caja', isTransactional: false },
        { code: '11050501', name: 'Caja general', isTransactional: true },
      ]),
    ).toEqual([{ code: '11050501', name: 'Caja general' }]);
  });
});

describe('collectUniqueAccountsCatalog', () => {
  it('sigue limitado a clases 5/6/7 para sugerencias de IA', () => {
    expect(
      collectUniqueAccountsCatalog([
        { code: '11050501', name: 'Caja', isTransactional: true },
        { code: '51050601', name: 'Aseo', isTransactional: true },
        { code: '71050511', name: 'Empaques', isTransactional: true },
      ]),
    ).toEqual([
      { code: '51050601', name: 'Aseo' },
      { code: '71050511', name: 'Empaques' },
    ]);
  });
});
