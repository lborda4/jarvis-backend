import { JarvisDashboardService } from './jarvis-dashboard.service';
function setup() {
  const query = jest.fn().mockResolvedValue([]);
  const integrations = { findByCompanyAndProvider: jest.fn().mockResolvedValue({ id: 'integration' }) };
  return { service: new JarvisDashboardService({ query } as never, integrations as never), query, integrations };
}
it('filtra por empresa autenticada, moneda y período sin crear tablas', async () => {
  const { service, query } = setup();
  const result = await service.summary('company-1', '2026-01');
  expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('company_id = $1'), ['company-1', '2025-08-01', '2026-02-01']);
  expect(query.mock.calls[0][0]).toContain("currency = 'COP'");
  expect(result.series).toHaveLength(6);
  expect(result.current).toMatchObject({ month: '2026-01', sales: 0, support: 0 });
});
it('resume ventas, soporte e impuestos con las reglas de emisión', async () => {
  const { service, query } = setup();
  query.mockResolvedValueOnce([{ month: '2026-10', kind: 'ELECTRONIC_INVOICE', total: '119000', count: 1, detailed: 1, iva: '19000' }, { month: '2026-10', kind: 'SUPPORT_DOCUMENT', total: '50000', count: 1, detailed: 1, iva: '0' }]);
  query.mockResolvedValueOnce([{ source_request: { items: [{ quantity: 1, unitValue: 100000, taxAmount: 19000 }], retentions: [{ id: 5, type: 'ReteRenta', percentage: 2.5 }, { id: 6, type: 'ReteIVA', percentage: 15 }, { id: 7, type: 'ReteICA', percentage: 9.66 }] } }]);
  const result = await service.summary('company-1', '2026-10');
  expect(result.current).toMatchObject({ sales: 119000, support: 50000 });
  expect(result.taxes).toMatchObject({ iva: 19000, reteRenta: 2500, reteIva: 2850, reteIca: 966 });
});
it.each(['2026-13', 'bad', '2026-00'])('rechaza mes inválido %s', async month => {
  const { service, query } = setup(); await expect(service.summary('company', month)).rejects.toThrow(); expect(query).not.toHaveBeenCalled();
});
it('no consulta datos de empresas sin Jarvis activo', async () => {
  const { service, query, integrations } = setup(); integrations.findByCompanyAndProvider.mockResolvedValue(null);
  await expect(service.summary('company', '2026-10')).rejects.toThrow(); expect(query).not.toHaveBeenCalled();
});

it('agrupa productos de ventas del mes por código y excluye soporte', async () => {
  const { service, query } = setup();
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([
    { document_kind: 'ELECTRONIC_INVOICE', source_request: { items: [{ code: 'A', description: 'Camisa', quantity: 2, unitValue: 100, discount: 10 }, { code: 'A', description: 'Camisa', quantity: 1, unitValue: 100 }] } },
    { document_kind: 'SUPPORT_DOCUMENT', source_request: { items: [{ code: 'B', description: 'Compra', quantity: 50, unitValue: 1000 }] } },
  ]);
  expect((await service.summary('company', '2026-10')).topProducts).toEqual([{ code: 'A', name: 'Camisa', quantity: 3, returnedQuantity: 0, netQuantity: 3, sales: 290 }]);
});

it('resta notas crédito de ventas, IVA, retenciones y productos sin descontarlas dos veces', async () => {
  const { service, query } = setup();
  query.mockResolvedValueOnce([
    { month: '2026-10', kind: 'ELECTRONIC_INVOICE', total: '238000', count: 2, detailed: 2, iva: '38000' },
    { month: '2026-10', kind: 'CREDIT_NOTE', total: '119000', count: 1, detailed: 1, iva: '19000' },
    { month: '2026-09', kind: 'CREDIT_NOTE', total: '50000', count: 1, detailed: 0, iva: '0' },
  ]).mockResolvedValueOnce([
    { document_kind: 'ELECTRONIC_INVOICE', source_request: { items: [{ code: 'A', description: 'Camisa', quantity: 2, unitValue: 100000, taxAmount: 38000, retention: { id: 6, type: 'ReteRenta', percentage: 2.5 } }], retentions: [{ id: 5, type: 'ReteIVA', percentage: 15 }, { id: 7, type: 'ReteICA', percentage: 9.66 }] } },
    { document_kind: 'CREDIT_NOTE', source_request: { items: [{ code: 'A', description: 'Camisa', quantity: 1, unitValue: 100000, taxAmount: 19000, retention: { id: 6, type: 'ReteRenta', percentage: 2.5 } }], retentions: [{ id: 5, type: 'ReteIVA', percentage: 15 }, { id: 7, type: 'ReteICA', percentage: 9.66 }] } },
  ]);
  const result = await service.summary('company', '2026-10');
  expect(query.mock.calls[0][0]).toContain("'CREDIT_NOTE'");
  expect(query.mock.calls[1][0]).toContain("'CREDIT_NOTE'");
  expect(result.current).toMatchObject({ sales: 238000, creditNotes: 119000, netSales: 119000, creditNotesCount: 1 });
  expect(result.series[4]).toMatchObject({ month: '2026-09', creditNotes: 50000, netSales: -50000 });
  expect(result.taxes.generated).toEqual({ iva: 38000, reteRenta: 5000, reteIca: 1932, reteIva: 5700 });
  expect(result.taxes.creditNotes).toEqual({ iva: 19000, reteRenta: 2500, reteIca: 966, reteIva: 2850 });
  expect(result.taxes).toMatchObject({ iva: 19000, reteRenta: 2500, reteIca: 966, reteIva: 2850 });
  expect(result.topProducts).toEqual([{ code: 'A', name: 'Camisa', quantity: 2, returnedQuantity: 1, netQuantity: 1, sales: 100000 }]);
});

it('conserva netos negativos por devoluciones de meses anteriores y reporta notas sin desglose', async () => {
  const { service, query } = setup();
  query.mockResolvedValueOnce([
    { month: '2026-10', kind: 'CREDIT_NOTE', total: '238000', count: 2, detailed: 1, iva: '19000' },
  ]).mockResolvedValueOnce([
    { document_kind: 'CREDIT_NOTE', source_request: { items: [{ code: 'A', description: 'Camisa', quantity: 1, unitValue: 100000, taxAmount: 19000 }] } },
    { document_kind: 'CREDIT_NOTE', source_request: null },
  ]);
  const result = await service.summary('company', '2026-10');
  expect(result.current.netSales).toBe(-238000);
  expect(result.taxes).toMatchObject({ iva: -19000, creditNoteDocuments: 2, detailedCreditNoteDocuments: 1 });
  expect(result.topProducts[0]).toMatchObject({ quantity: 0, returnedQuantity: 1, netQuantity: -1, sales: -100000 });
});

it('redondea las ventas netas a centavos', async () => {
  const { service, query } = setup();
  query.mockResolvedValueOnce([
    { month: '2026-10', kind: 'ELECTRONIC_INVOICE', total: '0.30', count: 1 },
    { month: '2026-10', kind: 'CREDIT_NOTE', total: '0.10', count: 1 },
  ]).mockResolvedValueOnce([]);
  expect((await service.summary('company', '2026-10')).current.netSales).toBe(0.2);
});
