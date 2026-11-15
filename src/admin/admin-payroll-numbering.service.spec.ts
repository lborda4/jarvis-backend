import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from './guards/admin.guard';
import { AdminPayrollNumberingController } from './admin-payroll-numbering.controller';
import { AdminPayrollNumberingService, PAYROLL_REGISTRATION_RANGES, payrollRegistrationStatus } from './admin-payroll-numbering.service';
import type { NextPymePayrollResolution } from '../integration/jarvis/nextpyme/nextpyme-api.client';

const remoteRange = (index: number, next = 1): NextPymePayrollResolution => {
  const range = PAYROLL_REGISTRATION_RANGES[index];
  return { typeDocumentId: range.type_document_id, prefix: range.prefix, from: range.from, to: range.to, nextConsecutive: next };
};
function setup(initial: NextPymePayrollResolution[] = [], stored = { next_number: 1, next_note_number: 1 }) {
  const remote = [...initial];
  const local = { ...stored };
  const query = jest.fn(async (sql: string, args: any[] = []): Promise<any[]> => {
    if (sql.startsWith('SELECT id FROM integrations')) return [{ id: 'integration' }];
    if (sql.startsWith('SELECT next_number')) return [{ ...local }];
    if (sql.startsWith('UPDATE jarvis_payroll_settings SET next_number=GREATEST')) {
      local.next_number = Math.max(local.next_number, args[1]); local.next_note_number = Math.max(local.next_note_number, args[2]);
    }
    return [];
  });
  const db = { query, transaction: jest.fn(async (fn: any) => fn({ query })) };
  const api = {
    getConfiguredPayrollResolutions: jest.fn(async () => [...remote]),
    configurePayrollResolution: jest.fn(async (payload: any, _token: string) => {
      if (!remote.some(row => row.prefix === payload.prefix && row.typeDocumentId === payload.type_document_id))
        remote.push({ typeDocumentId: payload.type_document_id, prefix: payload.prefix, from: payload.from, to: payload.to, nextConsecutive: 1 });
    }),
  };
  const catalogs = { requireCompanyToken: jest.fn().mockResolvedValue('company-token') };
  return { service: new AdminPayrollNumberingService(db as never, api as never, catalogs as never), api, query, local, catalogs, remote };
}

it('restringe tanto consulta como aplicación a administradores', () => {
  expect(Reflect.getMetadata(GUARDS_METADATA, AdminPayrollNumberingController)).toContain(AdminGuard);
});
it('consultar no hace PUT ni modifica contadores', async () => {
  const { service, api, query } = setup();
  expect((await service.status('company')).complete).toBe(false);
  expect(api.getConfiguredPayrollResolutions).toHaveBeenCalledWith('company-token');
  expect(api.configurePayrollResolution).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
});
it('aplica los cuatro campos confirmados por soporte cuando los rangos aún no existen', async () => {
  const { service, api } = setup();
  expect(await service.configure('company')).toMatchObject({ complete: true, registered: ['NI', 'NA'], applied: ['NI', 'NA'] });
  expect(api.configurePayrollResolution.mock.calls).toEqual(PAYROLL_REGISTRATION_RANGES.map(range => [range, 'company-token']));
});
it('hace los dos PUT aunque existan y usa los metadatos encontrados sin copiar id ni number', async () => {
  const configuration = { resolution: 'NOMINA', resolution_date: '2026-01-01', technical_key: '', date_from: '2026-01-01', date_to: '2030-12-31', generated_to_date: 14 };
  const { service, api } = setup([{ ...remoteRange(0, 15), configuration }, remoteRange(1, 3)]);
  expect(await service.configure('company')).toMatchObject({ registered: [], applied: ['NI', 'NA'] });
  expect(api.configurePayrollResolution.mock.calls).toEqual([
    [{ ...configuration, type_document_id: 9, prefix: 'NI', from: 1, to: 99999999 }, 'company-token'],
    [{ type_document_id: 10, prefix: 'NA', from: 1, to: 99999999 }, 'company-token'],
  ]);
});
it('conserva el mayor contador antes y después del PUT aunque el proveedor reporte luego uno menor', async () => {
  const { service, api, local, remote } = setup([remoteRange(0, 15), remoteRange(1, 7)], { next_number: 21, next_note_number: 2 });
  api.configurePayrollResolution.mockImplementation(async () => { for (const row of remote) row.nextConsecutive = 1; });
  await service.configure('company');
  expect(local).toEqual({ next_number: 21, next_note_number: 7 });
});
it('aplica ambos cuando solo falta uno y mantiene números locales más avanzados', async () => {
  const { service, api } = setup([remoteRange(0, 15)], { next_number: 18, next_note_number: 7 });
  const result = await service.configure('company');
  expect(api.configurePayrollResolution).toHaveBeenCalledTimes(2);
  expect(result.registered).toEqual(['NA']);
  expect(result.ranges.map(range => range.nextConsecutive)).toEqual([18, 7]);
});
it('un PUT fallido no se oculta aunque la consulta ya muestre ese rango', async () => {
  const { service, api, local } = setup([remoteRange(0, 15), remoteRange(1, 3)]);
  api.configurePayrollResolution.mockRejectedValueOnce(new Error('private-token'));
  await expect(service.configure('company')).rejects.toThrow('NI');
  expect(api.configurePayrollResolution).toHaveBeenCalledTimes(1);
  expect(local).toEqual({ next_number: 1, next_note_number: 1 });
});
it('permite reintentar ambos PUT tras fallo parcial sin reiniciar reservas locales', async () => {
  const { service, api, local } = setup([], { next_number: 15, next_note_number: 3 });
  const register = api.configurePayrollResolution.getMockImplementation()!;
  api.configurePayrollResolution.mockImplementationOnce(register).mockRejectedValueOnce(new Error('private-token'));
  await expect(service.configure('company')).rejects.toThrow('NA');
  api.configurePayrollResolution.mockClear();
  expect((await service.configure('company')).applied).toEqual(['NI', 'NA']);
  expect(api.configurePayrollResolution).toHaveBeenCalledTimes(2);
  expect(local).toEqual({ next_number: 15, next_note_number: 3 });
});
it('no aplica rangos incompatibles ni inventa un contador remoto desconocido', async () => {
  const { service, api } = setup([{ ...remoteRange(0), to: 20 }]);
  await expect(service.configure('company')).rejects.toThrow('rango');
  expect(api.configurePayrollResolution).not.toHaveBeenCalled();
  expect(payrollRegistrationStatus([{ ...remoteRange(0), nextConsecutive: null }]).ranges[0].issue).toContain('consecutivo');
});
it('no envía PUT si falla la consulta inicial o falta el token propio', async () => {
  const { service, api, catalogs } = setup();
  api.getConfiguredPayrollResolutions.mockRejectedValueOnce(new Error('read failed'));
  await expect(service.configure('company')).rejects.toThrow('read failed');
  expect(api.configurePayrollResolution).not.toHaveBeenCalled();
  catalogs.requireCompanyToken.mockRejectedValueOnce(new Error('Configura token'));
  await expect(service.configure('company')).rejects.toThrow('token');
});
