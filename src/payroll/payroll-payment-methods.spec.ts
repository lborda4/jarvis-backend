import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { payrollPaymentMaster, payrollPaymentPresets, type PayrollPaymentMethod } from './payroll-payment-methods';

function setup() {
  const rows: (PayrollPaymentMethod & { company: string })[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith('SELECT ')) return rows.filter(row => row.company === params[0]);
    if (sql.startsWith('INSERT INTO jarvis_payroll_payment_methods')) {
      const preset = sql.includes('ON CONFLICT');
      const systemKey = preset ? params[3] as 'cash' | 'transfer' : null;
      if (preset && rows.some(row => row.company === params[1] && row.systemKey === systemKey)) return [];
      const item = { id: String(params[0]), company: String(params[1]), name: String(params[2]), systemKey,
        nextpymeMethodId: Number(params[preset ? 4 : 3]), nextpymeMethodName: String(params[preset ? 5 : 4]) };
      rows.push(item);
      return [item];
    }
    return [];
  });
  const db = { query, transaction: jest.fn(async (fn) => fn({ query })) };
  const catalogs = { getPaymentMethods: jest.fn().mockResolvedValue([
    { id: 100, name: 'Efectivo', code: '10' },
    { id: 420, name: 'Transferencia crédito', code: '30' },
    { id: 430, name: 'Tarjeta crédito', code: '48' },
  ]) };
  const service = new PayrollService(db as never, catalogs as never, {} as never, {} as never);
  return { service, rows, query, catalogs, db };
}

it('inicializa solo efectivo y transferencia con los códigos del catálogo real', async () => {
  const { service, catalogs } = setup();
  const { items } = await service.paymentMethods('company-a');
  expect(items).toHaveLength(2);
  expect(items).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Efectivo', nextpymeMethodId: 100, systemKey: 'cash' }),
    expect.objectContaining({ name: 'Transferencia bancaria', nextpymeMethodId: 420, systemKey: 'transfer' }),
  ]));
  expect((await service.paymentMethods('company-a')).total).toBe(2);
  expect(catalogs.getPaymentMethods).toHaveBeenCalledTimes(1);
});

it('crea una opción propia de la empresa y no escribe en el catálogo de facturas', async () => {
  const { service, query } = setup();
  const result = await service.createPaymentMethod('company-a', 'actor', { name: ' Banco principal ', base: 'transfer' });
  expect(result.paymentMethod).toMatchObject({ name: 'Banco principal', nextpymeMethodId: 420, systemKey: null });
  expect((await service.paymentMethods('company-a')).total).toBe(3);
  expect((await service.paymentMethods('company-b')).items.some(row => row.name === 'Banco principal')).toBe(false);
  expect(query.mock.calls.some(([sql]) => /\bjarvis_payment_methods\b/.test(sql))).toBe(false);
});

it('permite crear una opción que use efectivo y registra la auditoría', async () => {
  const { service, query } = setup();
  const { paymentMethod } = await service.createPaymentMethod('company-a', 'actor', { name: 'Caja de nómina', base: 'cash' });
  expect(paymentMethod.nextpymeMethodId).toBe(100);
  expect(query.mock.calls.some(([sql, params]) => sql.includes('jarvis_payroll_audit') && params?.includes('PAYMENT_METHOD_CREATED'))).toBe(true);
});

it('rechaza nombres duplicados sin distinguir mayúsculas o espacios', async () => {
  const { service } = setup();
  await expect(service.createPaymentMethod('company-a', 'actor', { name: ' EFECTIVO ', base: 'cash' })).rejects.toBeInstanceOf(ConflictException);
});

it.each([{ name: '', base: 'cash' }, { name: 'x'.repeat(121), base: 'cash' }, { name: 'Tarjeta', base: 'credit' }])('valida los datos de creación %j', async request => {
  const { service, query } = setup();
  await expect(service.createPaymentMethod('company-a', 'actor', request)).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
});

it('maneja duplicados concurrentes con el índice único de base de datos', async () => {
  const { service, db } = setup();
  db.transaction.mockRejectedValueOnce({ code: '23505' });
  await expect(service.createPaymentMethod('company-a', 'actor', { name: 'Banco', base: 'transfer' })).rejects.toBeInstanceOf(ConflictException);
});

it('no inventa códigos ni inserta opciones incompletas si falta un medio maestro', async () => {
  const { service, rows, catalogs } = setup();
  catalogs.getPaymentMethods.mockResolvedValue([{ id: 100, name: 'Efectivo', code: '10' }]);
  await expect(service.paymentMethods('company-a')).rejects.toBeInstanceOf(ServiceUnavailableException);
  expect(rows).toHaveLength(0);
});

it('rechaza consultas sin empresa activa', async () => {
  const { service, query } = setup();
  await expect(service.paymentMethods('')).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
});

it('resuelve el nombre bancario del proveedor cuando el código es null', () => {
  const master = { id: 42, name: 'Transferecia Crédito', code: null };
  expect(payrollPaymentMaster([master], payrollPaymentPresets[1])).toBe(master);
});
