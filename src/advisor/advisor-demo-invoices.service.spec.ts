import { AdvisorDemoInvoicesService } from './advisor-demo-invoices.service';

const input = { id: '00b63a3c-1d3d-4c8f-a01c-6cb357544587', customerName: 'Cliente ficticio', customerIdentification: '123', description: 'Servicio demo', quantity: 2, unitValue: 100.25 };

function setup(existing?: object) {
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT next_invoice_number')) return [{ nextNumber: '7' }];
    if (sql.includes('FROM advisor_demo_invoices WHERE id')) return existing ? [existing] : [];
    if (sql.startsWith('INSERT INTO advisor_demo_invoices')) return [{ id: params?.[0], number: '7', total: params?.[7] }];
    return [];
  });
  const db = { transaction: jest.fn(async work => work({ query })), query: jest.fn() };
  return { service: new AdvisorDemoInvoicesService(db as never), db, query };
}

it('crea una factura simulada y asigna el número bajo bloqueo en una transacción', async () => {
  const { service, query } = setup();
  await expect(service.create(input, 'advisor')).resolves.toMatchObject({ number: '7', total: '200.50' });
  expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
  expect(query.mock.calls[2][1]).toEqual([input.id, '7', input.customerName, '123', input.description, '2.00', '100.25', '200.50', 'advisor']);
  expect(query.mock.calls[3][0]).toContain('next_invoice_number + 1');
});

it('recupera un reintento idéntico sin generar otro consecutivo', async () => {
  const { service, query } = setup({ ...input, quantity: '2.00', unitValue: '100.25', total: '200.50', createdBy: 'advisor', number: '7' });
  const result = await service.create(input, 'advisor');
  expect(result).toMatchObject({ number: '7', total: '200.50' });
  expect(result).not.toHaveProperty('createdBy');
  expect(query).toHaveBeenCalledTimes(2);
});

it('rechaza reutilizar el identificador con otro autor o datos', async () => {
  const { service, query } = setup({ ...input, quantity: '2.00', unitValue: '100.25', createdBy: 'other' });
  await expect(service.create(input, 'advisor')).rejects.toThrow('identificador');
  expect(query).toHaveBeenCalledTimes(2);
});

it.each([
  { ...input, id: 'invalid' },
  { ...input, customerName: ' ' },
  { ...input, quantity: 0 },
  { ...input, quantity: 1.001 },
  { ...input, unitValue: NaN },
  { ...input, unitValue: 100000000 },
])('rechaza los datos inválidos antes de escribir', async invalid => {
  const { service, db } = setup();
  await expect(service.create(invalid, 'advisor')).rejects.toThrow();
  expect(db.transaction).not.toHaveBeenCalled();
});

it('calcula el total con aritmética exacta sin acceder a empresas reales', async () => {
  const { service, query } = setup();
  await service.create({ ...input, quantity: 99999999, unitValue: 99999999 }, 'advisor');
  expect(query.mock.calls[2][1]?.[7]).toBe('9999999800000001.00');
  for (const [sql] of query.mock.calls) {
    expect(sql).not.toMatch(/\bFROM companies\b|\bjarvis_sales_invoices\b/i);
  }
});

it('acepta los decimales válidos cercanos al límite sin errores de redondeo binario', async () => {
  const { service, query } = setup();
  await service.create({ ...input, quantity: 1.23, unitValue: 99999998.99 }, 'advisor');
  expect(query.mock.calls[2][1]?.[7]).toBe('122999998.76');
});

it('pagina exclusivamente la tabla de simulación y valida la página', async () => {
  const { service, db } = setup();
  db.query.mockResolvedValueOnce([{ total: 25 }]).mockResolvedValueOnce([{ id: input.id }]);
  await expect(service.list('2')).resolves.toEqual({ items: [{ id: input.id }], total: 25, page: 2, pageSize: 20 });
  expect(db.query.mock.calls[1][1]).toEqual([20, 20]);
  await expect(service.list('0')).rejects.toThrow('página');
});
