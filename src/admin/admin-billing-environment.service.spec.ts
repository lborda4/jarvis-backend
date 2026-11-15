import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from './guards/admin.guard';
import { AdminBillingEnvironmentController } from './admin-billing-environment.controller';
import { AdminBillingEnvironmentService, BILLING_TEST_RESOLUTION, selectBillingProfile } from './admin-billing-environment.service';
import { withBillingOperation } from '../integration/jarvis/helpers/jarvis-billing-operation';

const production = { ...BILLING_TEST_RESOLUTION, prefix: 'FV', formNumber: '123', fromNumber: 1, toNumber: 1000, nextConsecutive: 53 };
function setup() {
  let configuration: any = {};
  let operations: Record<string, string> = {};
  let active = { ...production };
  const query = jest.fn(async (sql: string, args: any[] = []): Promise<any[]> => {
    if (sql.startsWith('SELECT credentials')) return [{ credentials: { resolutions: { electronic_invoice: active } } }];
    if (sql.startsWith('SELECT * FROM jarvis_billing')) return [{ configuration, operations }];
    if (sql.startsWith('SELECT configuration')) return [{ configuration }];
    if (sql.startsWith('UPDATE jarvis_billing_environments SET operations=$2')) operations = JSON.parse(args[1]);
    if (sql.startsWith('UPDATE jarvis_billing_environments SET operations=operations-')) { operations = { ...operations }; delete operations[args[1]]; }
    if (sql.startsWith('UPDATE jarvis_billing_environments SET configuration=')) configuration = JSON.parse(args[1]);
    if (sql.startsWith('SELECT COALESCE(MAX')) return [{ lastNumber: '0' }];
    if (sql.startsWith('UPDATE integrations')) { active = JSON.parse(args[2]); return [{ id: 'integration' }]; }
    return [];
  });
  const db = { query, transaction: jest.fn(async (fn: any) => fn({ query })) };
  const api = { configureBillingEnvironment: jest.fn().mockResolvedValue(undefined), putConfigResolution: jest.fn().mockResolvedValue({ success: true }) };
  const catalogs = { requireCompanyToken: jest.fn().mockResolvedValue('company-token'), invalidateResolutionsCache: jest.fn() };
  const service = new AdminBillingEnvironmentService(db as never, api as never, catalogs as never);
  return { db, query, api, service, configuration: () => configuration, active: () => active, advance: (next: number) => { active.nextConsecutive = next; } };
}

it('protege los dos endpoints con el guard de administrador', () => {
  expect(Reflect.getMetadata(GUARDS_METADATA, AdminBillingEnvironmentController)).toContain(AdminGuard);
});
it('envía solo el ambiente de facturación y configura SETP tipo 1 con el token de la empresa', async () => {
  const { service, api } = setup();
  expect(await service.configure('company', 2)).toMatchObject({ environment: 2, pending: false, resolution: { prefix: 'SETP', nextConsecutive: 990000000 } });
  expect(api.configureBillingEnvironment).toHaveBeenCalledWith(2, 'company-token');
  expect(api.putConfigResolution).toHaveBeenCalledWith({ type_document_id: 1, prefix: 'SETP', resolution: '18760000001',
    resolution_date: '2019-01-19', technical_key: BILLING_TEST_RESOLUTION.technicalKey,
    from: 990000000, to: 995000000, generated_to_date: 0, date_from: '2019-01-19', date_to: '2030-01-19' }, 'company-token');
});
it('restaura producción y conserva el avance de ambos prefijos al alternar', async () => {
  const { service, advance } = setup();
  await service.configure('company', 2);
  advance(990000007);
  expect(await service.configure('company', 1)).toMatchObject({ resolution: { prefix: 'FV', nextConsecutive: 53 } });
  advance(57);
  expect(await service.configure('company', 2)).toMatchObject({ resolution: { prefix: 'SETP', nextConsecutive: 990000007 } });
  expect(await service.configure('company', 1)).toMatchObject({ resolution: { prefix: 'FV', nextConsecutive: 57 } });
});
it('nunca retrocede respecto al historial del prefijo y rechaza rangos agotados', () => {
  expect(selectBillingProfile({}, production, 2, 990000010).resolution.nextConsecutive).toBe(990000011);
  expect(() => selectBillingProfile({}, production, 2, 995000000)).toThrow('agotó');
});
it('no inventa una resolución de producción si no hay una guardada', () => {
  expect(() => selectBillingProfile({}, BILLING_TEST_RESOLUTION, 1, 0)).toThrow('primero');
});
it.each(['environment', 'resolution', 'business'])('un fallo %s conserva el prefijo anterior, bloquea emisión y permite reintentar', async failure => {
  const { service, api, active, configuration, db } = setup();
  if (failure === 'environment') api.configureBillingEnvironment.mockRejectedValueOnce(new Error('secret'));
  else if (failure === 'resolution') api.putConfigResolution.mockRejectedValueOnce(new Error('secret'));
  else api.putConfigResolution.mockResolvedValueOnce({ success: false });
  await expect(service.configure('company', 2)).rejects.toThrow('Reintenta');
  expect(active().prefix).toBe('FV');
  expect(configuration().pending).toBe(true);
  await expect(withBillingOperation(db as never, 'company', 'send', async () => {})).rejects.toThrow('incompleto');
  expect(await service.configure('company', 2)).toMatchObject({ pending: false, environment: 2 });
});
it('no cambia el ambiente durante un envío y libera la operación incluso cuando falla', async () => {
  const { service, db } = setup();
  let release!: () => void;
  const sending = withBillingOperation(db as never, 'company', 'send', () => new Promise<void>(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  await expect(service.configure('company', 2)).rejects.toThrow('curso');
  release(); await sending;
  await expect(withBillingOperation(db as never, 'company', 'send', async () => { throw new Error('send failed'); })).rejects.toThrow('send failed');
  expect(await service.configure('company', 2)).toMatchObject({ environment: 2 });
});
it('rechaza ambientes distintos de 1 y 2 sin consultar NextPyme', async () => {
  const { service, api } = setup();
  await expect(service.configure('company', 3)).rejects.toThrow('Selecciona');
  expect(api.configureBillingEnvironment).not.toHaveBeenCalled();
});
