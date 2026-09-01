import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import {
  buildTaxCatalogById,
  classifySiigoPurchaseTaxes,
  mapSiigoItemTypeToHistorialTipo,
} from './siigo-purchase-tax-classification.helper';
import { HistorialFacturaTipo } from '../../enums/historial-factura-tipo.enum';

describe('classifySiigoPurchaseTaxes', () => {
  const catalog: SiigoTaxCatalogItemDto[] = [
    { id: 18900, name: 'IVA Activo Fijo', type: 'IVA', percentage: 19, active: true },
    { id: 11811, name: 'Retefuente 1% Transp mercancía', type: 'Retefuente', percentage: 1, active: true },
    { id: 11798, name: 'ReteICA 11.04 Compras bienes', type: 'ReteICA', percentage: 11.04, active: true },
    { id: 11805, name: 'ReteIVA 15%', type: 'ReteIVA', percentage: 15, active: true },
  ];
  const catalogById = buildTaxCatalogById(catalog);

  it('clasifica IVA y Retefuente de items[].taxes y ReteICA de retentions[] en sus baldes', () => {
    const impuestos = classifySiigoPurchaseTaxes(
      [
        { id: 18900, name: 'IVA Activo Fijo', type: 'IVA', percentage: 19, value: 95000 },
        { id: 11811, name: 'Retefuente 1% Transp mercancía', type: 'Retefuente', percentage: 1, value: 5000 },
      ],
      [{ id: 11798, name: 'ReteICA 11.04 Compras bienes', type: 2, percentage: 11.04, value: 11040 }],
      catalogById,
    );

    expect(impuestos.iva).toEqual({ id: 18900, name: 'IVA Activo Fijo', percentage: 19 });
    expect(impuestos.retefuente).toEqual({
      id: 11811,
      name: 'Retefuente 1% Transp mercancía',
      percentage: 1,
    });
    expect(impuestos.reteica).toEqual({
      id: 11798,
      name: 'ReteICA 11.04 Compras bienes',
      percentage: 11.04,
    });
    expect(impuestos.autorretencion).toBeUndefined();
    expect(impuestos.tarifas).toBeUndefined();
  });

  it('manda a tarifas los impuestos sin categoría reconocida (ej. ReteIVA) y los repetidos', () => {
    const impuestos = classifySiigoPurchaseTaxes(
      [{ id: 18900, name: 'IVA', type: 'IVA', percentage: 19, value: 1 }],
      [
        { id: 11805, name: 'ReteIVA 15%', type: 3, percentage: 15, value: 1 },
        { id: 99999, name: 'Impuesto desconocido', type: 9, percentage: 2, value: 1 },
      ],
      catalogById,
    );

    expect(impuestos.iva).toBeDefined();
    expect(impuestos.tarifas).toEqual([
      { id: 11805, name: 'ReteIVA 15%', percentage: 15 },
      { id: 99999, name: 'Impuesto desconocido', percentage: 2 },
    ]);
  });

  it('manda a tarifas el segundo impuesto de la misma categoría en vez de sobrescribir el primero', () => {
    const impuestos = classifySiigoPurchaseTaxes(
      [
        { id: 18900, name: 'IVA 19%', type: 'IVA', percentage: 19, value: 1 },
        { id: 18901, name: 'IVA 5% (otra línea)', type: 'IVA', percentage: 5, value: 1 },
      ],
      undefined,
      catalogById,
    );

    expect(impuestos.iva).toEqual({ id: 18900, name: 'IVA 19%', percentage: 19 });
    expect(impuestos.tarifas).toEqual([{ id: 18901, name: 'IVA 5% (otra línea)', percentage: 5 }]);
  });
});

describe('mapSiigoItemTypeToHistorialTipo', () => {
  it('mapea "Product" a PRODUCTO', () => {
    expect(mapSiigoItemTypeToHistorialTipo('Product')).toBe(HistorialFacturaTipo.PRODUCTO);
  });

  it('mapea "Account" y cualquier otro valor a CUENTA', () => {
    expect(mapSiigoItemTypeToHistorialTipo('Account')).toBe(HistorialFacturaTipo.CUENTA);
    expect(mapSiigoItemTypeToHistorialTipo(undefined)).toBe(HistorialFacturaTipo.CUENTA);
  });
});
