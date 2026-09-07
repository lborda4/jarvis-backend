import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import { resolveSuggestedTaxForItem } from './siigo-item-tax-suggestion.helper';

function buildCatalog(): SiigoTaxCatalogItemDto[] {
  return [
    { id: 1, name: 'IVA 19%', type: 'IVA', percentage: 19, active: true },
    { id: 2, name: 'IVA 5%', type: 'IVA', percentage: 5, active: true },
    { id: 3, name: 'IVA 0%', type: 'IVA', percentage: 0, active: true },
    {
      id: 4,
      name: 'ReteFuente 2.5%',
      type: 'ReteFuente',
      percentage: 19,
      active: true,
    },
    { id: 5, name: 'IVA 19% inactivo', type: 'IVA', percentage: 19, active: false },
  ];
}

describe('resolveSuggestedTaxForItem', () => {
  it('matches an active IVA tax with the same percentage', () => {
    const suggestion = resolveSuggestedTaxForItem(19, buildCatalog());
    expect(suggestion).toEqual({ id: 1, name: 'IVA 19%', percentage: 19 });
  });

  it('tolerates floating point noise in the percentage', () => {
    const suggestion = resolveSuggestedTaxForItem(19.0000001, buildCatalog());
    expect(suggestion?.id).toBe(1);
  });

  it('does not match a retention with the same percentage as an IVA', () => {
    const catalog = buildCatalog().filter((tax) => tax.type !== 'IVA');
    expect(resolveSuggestedTaxForItem(19, catalog)).toBeNull();
  });

  it('ignores inactive taxes', () => {
    const catalog = buildCatalog().filter((tax) => tax.id !== 1);
    expect(resolveSuggestedTaxForItem(19, catalog)).toBeNull();
  });

  it('returns null when there is no percentage to match', () => {
    expect(resolveSuggestedTaxForItem(undefined, buildCatalog())).toBeNull();
  });

  it('returns null when no tax in the catalog matches the percentage', () => {
    expect(resolveSuggestedTaxForItem(7, buildCatalog())).toBeNull();
  });

  it('matches a 0% IVA (exento) correctly', () => {
    const suggestion = resolveSuggestedTaxForItem(0, buildCatalog());
    expect(suggestion?.id).toBe(3);
  });

  it('returns null when multiple active IVA taxes share the same percentage (ambiguous)', () => {
    const catalog: SiigoTaxCatalogItemDto[] = [
      ...buildCatalog(),
      { id: 6, name: 'IVA Activo Fijo', type: 'IVA', percentage: 19, active: true },
    ];

    expect(resolveSuggestedTaxForItem(19, catalog)).toBeNull();
  });
});
