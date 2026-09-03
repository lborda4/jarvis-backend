import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import { resolveSuggestedRetentionsFromInvoice } from './siigo-support-document-retention.helper';

function buildTax(overrides: Partial<SiigoTaxCatalogItemDto>): SiigoTaxCatalogItemDto {
  return {
    id: 1,
    name: 'Impuesto',
    type: 'IVA',
    percentage: 0,
    active: true,
    ...overrides,
  };
}

describe('resolveSuggestedRetentionsFromInvoice', () => {
  const taxesCatalog: SiigoTaxCatalogItemDto[] = [
    buildTax({ id: 501, name: 'Retefuente servicios 4%', type: 'Retefuente', percentage: 4 }),
    buildTax({ id: 502, name: 'ReteICA Bogotá', type: 'ReteICA', percentage: 0.966 }),
    buildTax({ id: 503, name: 'ReteIVA 15%', type: 'ReteIVA', percentage: 15 }),
  ];

  it('matchea Retefuente por código DIAN 06, aunque NextPyme lo llame "ReteRenta" en vez de "ReteFuente"', () => {
    const result = resolveSuggestedRetentionsFromInvoice(
      [{ dianTaxCode: '06', percentage: 4 }],
      taxesCatalog,
    );

    expect(result).toEqual([
      { id: 501, name: 'Retefuente servicios 4%', type: 'Retefuente', percentage: 4 },
    ]);
  });

  it('matchea ReteICA (código 07) y ReteIVA (código 05) a la vez', () => {
    const result = resolveSuggestedRetentionsFromInvoice(
      [
        { dianTaxCode: '07', percentage: 0.966 },
        { dianTaxCode: '05', percentage: 15 },
      ],
      taxesCatalog,
    );

    expect(result).toEqual([
      { id: 502, name: 'ReteICA Bogotá', type: 'ReteICA', percentage: 0.966 },
      { id: 503, name: 'ReteIVA 15%', type: 'ReteIVA', percentage: 15 },
    ]);
  });

  it('no sugiere nada si el porcentaje no matchea ningún impuesto real del catálogo (nunca adivina)', () => {
    const result = resolveSuggestedRetentionsFromInvoice(
      [{ dianTaxCode: '06', percentage: 3.5 }],
      taxesCatalog,
    );

    expect(result).toEqual([]);
  });

  it('ignora códigos DIAN desconocidos (ej. Autorretención, sin código confirmado)', () => {
    const result = resolveSuggestedRetentionsFromInvoice(
      [{ dianTaxCode: '99', percentage: 4 }],
      taxesCatalog,
    );

    expect(result).toEqual([]);
  });

  it('ignora impuestos inactivos del catálogo', () => {
    const result = resolveSuggestedRetentionsFromInvoice(
      [{ dianTaxCode: '06', percentage: 4 }],
      [buildTax({ id: 501, type: 'Retefuente', percentage: 4, active: false })],
    );

    expect(result).toEqual([]);
  });

  it('devuelve vacío si no hay retenciones en la factura', () => {
    expect(resolveSuggestedRetentionsFromInvoice(undefined, taxesCatalog)).toEqual([]);
    expect(resolveSuggestedRetentionsFromInvoice([], taxesCatalog)).toEqual([]);
  });
});
