import {
  resolveImportedSupplierName,
  normalizeSupplierNit,
} from './supplier-name-resolution.helper';

describe('supplier-name-resolution.helper', () => {
  it('prioriza el nombre configurado en BD sobre el del Excel', () => {
    const lookup = new Map([['900685902', 'DISTRIBUIDORA Y COMERCIALIZADORA LA LUZ']]);

    expect(
      resolveImportedSupplierName(
        '900685902',
        'DISTRIBUIDORA LA LUZ',
        lookup,
      ),
    ).toBe('DISTRIBUIDORA Y COMERCIALIZADORA LA LUZ');
  });

  it('usa el nombre del Excel cuando el NIT no existe en BD', () => {
    expect(
      resolveImportedSupplierName('900685902', 'DISTRIBUIDORA LA LUZ', new Map()),
    ).toBe('DISTRIBUIDORA LA LUZ');
  });

  it('normaliza el NIT a solo dígitos', () => {
    expect(normalizeSupplierNit('900.685.902-2')).toBe('9006859022');
  });
});
