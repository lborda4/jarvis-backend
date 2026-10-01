import { dominantCostCenter, resolveHistoricalCostCenter } from './siigo-cost-center-history.helper';
import { SiigoPurchaseHistorySyncService } from '../siigo-purchase-history-sync.service';
import { buildTaxCatalogById } from './siigo-purchase-tax-classification.helper';

const center = { id: 12, code: '001', name: 'Administración' };
describe('Centros de costo del historial de compras', () => {
  it.each([0, 6, 7])('deja vacío con %s de 10 facturas usando el centro', count => {
    expect(dominantCostCenter([
      { proveedorNit: '900', id: 12, count },
      { proveedorNit: '900', id: null, count: 10 - count },
    ], [center]).valor).toBeNull();
  });
  it('sugiere cuando supera el 70%, incluyendo sin centro en el denominador', () => {
    expect(dominantCostCenter([
      { proveedorNit: '900', id: 12, count: 8 },
      { proveedorNit: '900', id: null, count: 2 },
    ], [center])).toEqual({ variable: false, valor: center });
  });
  it('no sugiere un centro eliminado del catálogo', () => {
    expect(dominantCostCenter([{ proveedorNit: '900', id: 12, count: 20 }], []).valor).toBeNull();
  });
  it('conserva la referencia histórica aunque ya no exista en el catálogo', () => {
    expect(resolveHistoricalCostCenter(center, [])).toEqual(center);
    expect(resolveHistoricalCostCenter(12, [center])).toEqual(center);
    expect(resolveHistoricalCostCenter(undefined, [center])).toBeNull();
  });
  it('guarda el centro de cada factura en todas sus líneas, y null cuando no tiene', async () => {
    const repository = { create: jest.fn(value => value), replaceRowsForFacturas: jest.fn() };
    const service = Object.assign(Object.create(SiigoPurchaseHistorySyncService.prototype), {
      historialFacturasRepository: repository,
      siigoCostCentersCatalogService: { listCostCenters: jest.fn(async () => [center]) },
    });
    const item = { type: 'Account', code: '5105', description: 'Servicio', taxes: [] };
    await service.persistPageBatch('company', 'integration', [
      { id: 'one', date: '2026-09-30', supplier: { identification: '900' }, cost_center: 12, items: [item, item] },
      { id: 'two', date: '2026-09-30', supplier: { identification: '900' }, items: [item] },
    ], '2025-01-01', buildTaxCatalogById([]), new Map());
    const rows = repository.replaceRowsForFacturas.mock.calls[0][3];
    expect(rows.map(row => row.centroCosto)).toEqual([center, center, null]);
    expect(rows.every(row => row.companyId === 'company' && row.integrationId === 'integration')).toBe(true);
  });
});
