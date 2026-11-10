import { PayrollService } from './payroll.service';

describe('tipo de documento de nómina al sincronizar ambiente', () => {
  function environmentSetup(success = true) {
    const query = jest.fn().mockResolvedValue([]);
    const api = { payrollRequest: jest.fn().mockResolvedValue({ success }) };
    const catalogs = { requireCompanyToken: jest.fn().mockResolvedValue('company-token') };
    const service = new PayrollService({ query, manager: { query } } as never, catalogs as never, api as never, {} as never);
    return { service, query, api };
  }
  it.each([1, 2])('envía type_document_id 9 con el ambiente %s sin solicitarlo al usuario', async environment => {
    const { service, api, query } = environmentSetup();
    jest.spyOn(service, 'bootstrap').mockResolvedValue({ settings: { environment } } as never);
    await service.configureEnvironment('company-a', 'actor');
    expect(api.payrollRequest).toHaveBeenCalledWith('config/environment', { type_document_id: 9, payroll_type_environment_id: environment }, 'company-token', 'PUT');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('syncedEnvironment'), ['company-a', environment]);
  });
  it('no marca el ambiente como sincronizado si NextPyme rechaza la solicitud', async () => {
    const { service, query } = environmentSetup(false);
    jest.spyOn(service, 'bootstrap').mockResolvedValue({ settings: { environment: 2 } } as never);
    await expect(service.configureEnvironment('company-a', 'actor')).rejects.toThrow('no confirmó');
    expect(query).not.toHaveBeenCalled();
  });
});

const parameters = { validFrom: '2026-01-01', minimumSalary: '1750905', transportAllowance: '249095', monthlyDays: '30', weeklyHours: '42', monthlyHours: '210', concepts: [] };
describe('guardar cambios de configuración de nómina', () => {
  beforeAll(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-29T02:00:00Z')); });
  afterAll(() => jest.useRealTimers());
  function setup() {
    const query = jest.fn(async (sql: string) => sql.includes('INSERT INTO jarvis_payroll_parameters') ? [{ id: 'saved-parameters' }] : []);
    return { query, service: new PayrollService({ transaction: async (work: any) => work({ query }) } as any, {} as any, {} as any, {} as any) };
  }
  it('permite guardar una eliminación aunque ya exista una configuración de hoy', async () => {
    const { service, query } = setup();
    await expect(service.saveParameters('company', 'actor', parameters, true)).resolves.toEqual({ id: 'saved-parameters' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT(company_id,valid_from) DO UPDATE SET data=EXCLUDED.data'), expect.arrayContaining(['company', '2026-10-28']));
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO jarvis_payroll_audit'), expect.arrayContaining(['PARAMETERS_SAVED', 'saved-parameters']));
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE jarvis_payroll_documents'))).toBe(false);
  });
  it('mantiene la creación de versiones históricas sin sobrescribirlas', async () => {
    const { service, query } = setup();
    await service.saveParameters('company', 'actor', parameters);
    expect(query.mock.calls[0][0]).not.toContain('ON CONFLICT');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO jarvis_payroll_parameters'), expect.arrayContaining(['2026-01-01']));
  });
  it('rechaza eliminar una categoría todavía usada por conceptos personalizados', async () => {
    const { service, query } = setup();
    await expect(service.saveParameters('company', 'actor', { ...parameters, concepts: [{ code: 'internal_test', name: 'Prueba', kind: 'accrued', category: 'deleted', base: 'manual' }] }, true)).rejects.toThrow('categoría válida');
    expect(query).not.toHaveBeenCalled();
  });
});
