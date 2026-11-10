import { JarvisReportsService } from './jarvis-reports.service';
import { buildReportSuggestions } from './helpers/jarvis-report-suggestions.helper';
import type { ReportDocument } from './jarvis-reports.types';

function document(overrides: Partial<ReportDocument> = {}): ReportDocument {
  return { id: 'invoice', kind: 'ELECTRONIC_INVOICE', date: '2026-11-06', number: 'FE21', customerId: '123', customerName: 'García', currency: 'COP', total: '100', source: null, ...overrides };
}
function setup(documents = [document()]) {
  const source = { query: jest.fn().mockResolvedValueOnce(documents).mockResolvedValue([]) };
  const integrations = { findByCompanyAndProvider: jest.fn().mockResolvedValue({ id: 'integration' }) };
  const service = new JarvisReportsService(source as never, integrations as never);
  return { service, source, integrations };
}
const query = { report: 'customers', from: '2026-11-01', to: '2026-11-30' };

it('sugiere datos conservados del comprobante y deduplica por identificador', () => {
  const source = { items: [{ code: 'P01', description: 'Servicio mensual' }, { description: 'Sin código' }], sellers: [{ id: 'seller', name: 'Ana García' }] } as unknown as ReportDocument['source'];
  const result = buildReportSuggestions([document({ source }), document({ source })]);
  expect(result.customers).toEqual([{ value: '123', label: 'García — 123' }]);
  expect(result.products).toEqual([{ value: 'P01', label: 'Servicio mensual — P01' }, { value: 'Sin código', label: 'Sin código' }]);
  expect(result.sellers).toEqual([{ value: 'seller', label: 'Ana García — seller' }]);
  expect(result.search).toEqual(expect.arrayContaining([{ value: 'FE21', label: 'FE21' }, { value: '123', label: 'García — 123' }]));
});
it('combina catálogos e historial sin duplicar ni perder registros eliminados', () => {
  const result = buildReportSuggestions([document(), document({ customerId: 'old', customerName: 'Cliente eliminado' })], {
    customers: [{ value: '123', name: 'Nombre actual' }, { value: 'new', name: 'Cliente sin ventas' }],
    products: [{ value: 'SKU01', name: 'Producto sin ventas' }],
    sellers: [{ value: 'seller01', name: 'Vendedor sin ventas' }],
  });
  expect(result.customers).toHaveLength(3);
  expect(result.customers).toContainEqual({ value: '123', label: 'Nombre actual — 123' });
  expect(result.customers).toContainEqual({ value: 'new', label: 'Cliente sin ventas — new' });
  expect(result.customers).toContainEqual({ value: 'old', label: 'Cliente eliminado — old' });
  expect(result.products).toEqual([{ value: 'SKU01', label: 'Producto sin ventas — SKU01' }]);
  expect(result.sellers).toEqual([{ value: 'seller01', label: 'Vendedor sin ventas — seller01' }]);
});
it('consulta todos los catálogos de la empresa aunque el período no tenga comprobantes', async () => {
  const { service, source } = setup([]);
  source.query.mockReset()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ value: '900', name: 'Cliente guardado' }])
    .mockResolvedValueOnce([{ value: 'P01', name: 'Producto guardado' }])
    .mockResolvedValueOnce([{ value: 'seller', name: 'Ana' }]);
  const result = await service.suggestions('company-a', query);
  for (const table of ['jarvis_terceros', 'products', 'jarvis_sellers']) {
    expect(source.query).toHaveBeenCalledWith(expect.stringContaining('FROM ' + table + ' WHERE company_id=$1'), ['company-a']);
  }
  expect(result.customers[0].value).toBe('900');
  expect(result.products[0].value).toBe('P01');
  expect(result.sellers[0].value).toBe('seller');
});
it('incluye el vendedor heredado por las notas y prioriza los vendedores propios', () => {
  const inherited = { id: 'original', name: 'Contador original' };
  const own = { id: 'own', name: 'Vendedor propio' };
  expect(buildReportSuggestions([document({ kind: 'CREDIT_NOTE', referenceSellers: [inherited] })]).sellers).toEqual([{ value: 'original', label: 'Contador original — original' }]);
  expect(buildReportSuggestions([document({ source: { sellers: [own] } as unknown as ReportDocument['source'], referenceSellers: [inherited] })]).sellers).toEqual([{ value: 'own', label: 'Vendedor propio — own' }]);
});
it('no inventa productos ni vendedores cuando falta el detalle histórico', () => {
  const result = buildReportSuggestions([document()]);
  expect(result.products).toEqual([]); expect(result.sellers).toEqual([]);
  expect(result.customers).toHaveLength(1);
  expect(buildReportSuggestions([])).toEqual({ customers: [], products: [], sellers: [], search: [] });
});
it('acota las sugerencias a la empresa, fechas y tipos y no al texto ya escrito', async () => {
  const { service, source } = setup();
  const result = await service.suggestions('company-a', { ...query, kind: 'CREDIT_NOTE', customer: 'garcia', product: 'otro', seller: 'otra', search: 'anterior' });
  const [sql, params] = source.query.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('i.company_id=$1 AND i.issue_date >= $2::date AND i.issue_date <= $3::date');
  expect(params).toEqual(['company-a', query.from, query.to, ['CREDIT_NOTE']]);
  expect(result.customers).toHaveLength(1);
});
it('sugiere clientes de todo el período, aunque no estén en la página actual', async () => {
  const { service } = setup(Array.from({ length: 25 }, (_, index) => document({ id: `invoice-${index}`, customerId: `${index}`, customerName: `Cliente ${index}` })));
  expect((await service.suggestions('company-a', { ...query, page: '2', pageSize: '10' })).customers).toHaveLength(25);
});
it('rechaza empresas sin integración y rangos inválidos antes de consultar sus comprobantes', async () => {
  const { service, source, integrations } = setup();
  await expect(service.suggestions('company-a', { ...query, to: '2026-10-01' })).rejects.toThrow('fecha inicial');
  integrations.findByCompanyAndProvider.mockResolvedValue(null);
  await expect(service.suggestions('company-a', query)).rejects.toThrow('no tiene integración');
  await expect(service.suggestions('', query)).rejects.toThrow('empresa activa');
  expect(source.query).not.toHaveBeenCalled();
});
it('conserva la consulta y su paginación después de compartir la lectura de comprobantes', async () => {
  const { service } = setup();
  const result = await service.query('company-a', { ...query, view: 'detail', page: '1', pageSize: '10' });
  expect(result.total).toBe(1);
  expect(result.items[0]).toMatchObject({ customerId: '123', customerName: 'García' });
  expect(result.page).toBe(1);
});
