import { PayrollService } from './payroll.service';

const parameters = { validFrom: '2026-01-01', minimumSalary: '1750905', transportAllowance: '249095', monthlyDays: '30', weeklyHours: '42', monthlyHours: '210', concepts: [] };
describe('inicializar parámetros internos de nómina', () => {
  beforeAll(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-29T02:00:00Z')); });
  afterAll(() => jest.useRealTimers());
  function setup() {
    const query = jest.fn(async (sql: string) => sql.includes('INSERT INTO jarvis_payroll_parameters') ? [{ id: 'saved-parameters' }] : []);
    return { query, service: new PayrollService({ transaction: async (work: any) => work({ query }) } as any, {} as any, {} as any, {} as any) };
  }
  it('mantiene la creación de versiones históricas sin sobrescribirlas', async () => {
    const { service, query } = setup();
    await service.saveParameters('company', 'actor', parameters);
    expect(query.mock.calls[0][0]).not.toContain('ON CONFLICT');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO jarvis_payroll_parameters'), expect.arrayContaining(['2026-01-01']));
  });
  it('rechaza un concepto interno sin categoría válida', async () => {
    const { service, query } = setup();
    await expect(service.saveParameters('company', 'actor', { ...parameters, concepts: [{ code: 'internal_test', name: 'Prueba', kind: 'accrued', category: 'deleted', base: 'manual' }] })).rejects.toThrow('categoría válida');
    expect(query).not.toHaveBeenCalled();
  });
});
