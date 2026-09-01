import {
  buildAccountNameByCode,
  resolveAccountNameFromCatalog,
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
