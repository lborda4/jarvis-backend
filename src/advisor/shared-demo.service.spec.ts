import { SharedDemoService } from './shared-demo.service';
import { SHARED_DEMO_COMPANY_ID } from './shared-demo.constants';

it('grants different advisors the same persisted company without creating a tenant per advisor', async () => {
  const company = {
    id: SHARED_DEMO_COMPANY_ID,
    name: 'Empresa demo Jarvis',
    nit: '900000000',
    isDemo: true,
    jarvisModules: ['BILLING', 'PAYROLL'],
  };
  const findOne = jest.fn().mockResolvedValue(company);
  const query = jest.fn().mockResolvedValue([]);
  const db = {
    getRepository: () => ({ findOne }),
    transaction: jest.fn(async (work) => work({ query })),
  };
  const service = new SharedDemoService(db as never);
  for (const user of ['commercial-a', 'commercial-b'])
    expect(await service.grantAccess(user)).toEqual(company);
  expect(findOne).toHaveBeenCalledWith({
    where: { id: SHARED_DEMO_COMPANY_ID, isDemo: true },
  });
  expect(
    query.mock.calls
      .filter(([sql]) => sql.startsWith('INSERT INTO user_companies'))
      .map(([, args]) => args),
  ).toEqual([
    ['commercial-a', SHARED_DEMO_COMPANY_ID],
    ['commercial-b', SHARED_DEMO_COMPANY_ID],
  ]);
  expect(
    query.mock.calls.some(([sql]) => sql.includes('pg_advisory_xact_lock')),
  ).toBe(true);
  expect(
    query.mock.calls.some(([sql]) => sql.includes('INSERT INTO companies')),
  ).toBe(false);
});
it('does not grant access when the shared tenant migration is missing', async () => {
  const db = {
    getRepository: () => ({ findOne: async () => null }),
    transaction: jest.fn(),
  };
  await expect(
    new SharedDemoService(db as never).grantAccess('commercial'),
  ).rejects.toThrow('migraciones');
  expect(db.transaction).not.toHaveBeenCalled();
});
