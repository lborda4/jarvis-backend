import { clientLifecycleStatus } from './client-lifecycle';
import type { Company } from '../company/entities/company.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';

const company = (paid = false) => ({ id: 'company', advisorId: 'advisor', commercialActivity: paid ? [{ kind: 'PAYMENT' }] : [], integrations: [] } as unknown as Company);
const db = { getRepository: jest.fn(() => ({ count: jest.fn(async () => 1) })) };
const siigo = () => ({ id: 'siigo', provider: IntegrationProvider.SIIGO, active: true, accountsExcelImportedAt: new Date(), includedDocumentTypes: ['SUPPORT_DOCUMENT'], credentials: { username: 'user', access_key: 'key', document_types: { support_document_id: 1 } } });
const jarvis = () => ({ id: 'jarvis', provider: IntegrationProvider.JARVIS, active: true, credentials: {
  business_name: 'Cliente', economic_activity: '1234', tax_regime: 'common', vat_regime: 'vat_responsible', tax_responsibility: 'O-13',
  country: 'Colombia', department: 'Bogotá', municipality: 'Bogotá', city: 'Bogotá', email: 'cliente@example.test', address: 'Calle 1', phone: '3101234567',
} });
it('starts at payment verification even if setup was completed first', async () => {
  const client = company();client.integrations = [siigo()] as never;
  expect(await clientLifecycleStatus(client, db as never)).toBe('VERIFY_PAYMENT');
});
it('remains paid until all Siigo setup steps are complete', async () => {
  const client = company(true);const integration = siigo();client.integrations = [integration] as never;
  integration.accountsExcelImportedAt = null as never;
  expect(await clientLifecycleStatus(client, db as never)).toBe('PAID');
  integration.accountsExcelImportedAt = new Date();integration.credentials.document_types.support_document_id = 0;
  expect(await clientLifecycleStatus(client, db as never)).toBe('PAID');
  integration.credentials.document_types.support_document_id = 1;
  expect(await clientLifecycleStatus(client, db as never)).toBe('ACTIVE');
});
it('requires actual imported accounts, not only the import timestamp', async () => {
  const client = company(true);client.integrations = [siigo()] as never;
  expect(await clientLifecycleStatus(client, { getRepository: () => ({ count: async () => 0 }) } as never)).toBe('PAID');
});
it('does not mark paid companies with no integrations or missing company data active', async () => {
  const client = company(true);expect(await clientLifecycleStatus(client, db as never)).toBe('PAID');
  client.integrations = [{ provider: IntegrationProvider.JARVIS, active: true, credentials: {} }] as never;
  expect(await clientLifecycleStatus(client, db as never)).toBe('PAID');
});
it('preserves non-advisor legacy client management', async () => {
  const client = company();client.advisorId = null;
  expect(await clientLifecycleStatus(client, db as never)).toBeNull();
});

it('moves Jarvis from paid to active when a billing resolution is configured', async () => {
  const client = company(true); const integration = jarvis(); client.integrations = [integration] as never;
  expect(await clientLifecycleStatus(client, db as never)).toBe('PAID');
  (integration.credentials as any).resolutions = { electronic_invoice: { prefix: 'FV', documentTypeLabel: 'Factura electrónica', formNumber: '123', fromNumber: 1, toNumber: 100 } };
  expect(await clientLifecycleStatus(client, db as never)).toBe('ACTIVE');
});
it('uses company setup for payroll-only companies without demanding invoice resolutions', async () => {
  const client = company(true);client.jarvisModules = ['PAYROLL'];client.integrations = [jarvis()] as never;
  expect(await clientLifecycleStatus(client, db as never)).toBe('ACTIVE');
});
it('requires every enabled integration to complete its initial setup', async () => {
  const client = company(true);client.jarvisModules = ['PAYROLL'];const integration = siigo();
  client.integrations = [jarvis(), integration] as never;
  integration.credentials.access_key = '';
  expect(await clientLifecycleStatus(client, db as never)).toBe('PAID');
  integration.credentials.access_key = 'key';
  expect(await clientLifecycleStatus(client, db as never)).toBe('ACTIVE');
});
