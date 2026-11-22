import { AdminService } from '../admin/admin.service';
import { Company } from '../company/entities/company.entity';
import { Integration } from '../integration/entities/integration.entity';
import { UserCompany } from '../auth/entities/user-company.entity';
import { AdvisorSale } from './advisor-sale.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { CompanyPersonType } from '../company/enums/company-person-type.enum';
import { ElectronicDocumentType } from '../electronic-document/enums/electronic-document-type.enum';
import type { Advisor } from '../auth/entities/advisor.entity';

function setup() {
  let company: Record<string, unknown>, integration: Record<string, unknown>, sale: Record<string, unknown>;
  const plan = { id: 'plan', name: 'Siigo Plus', code: 'siigo-plus', provider: IntegrationProvider.SIIGO, commissionClass: 'PLUS', salePriceCop: '100000.00', active: true };
  const advisor = { id: 'advisor', user: { email: 'advisor@example.com', name: 'Laura' } } as Advisor;
  const companyRepo = { create: value => ({ id: 'company', createdAt: new Date(), ...value }), save: jest.fn(async value => { company = value; return value; }), findOne: jest.fn(async () => ({ ...company, integrations: [integration] })) };
  const integrations = { findOne: jest.fn(async () => null), create: value => ({ id: 'integration', ...value }), save: jest.fn(async value => { integration = value; return value; }) };
  const links = { findOne: jest.fn(), save: jest.fn() };
  const builder = { insert: () => builder, values: value => { sale = value; return builder; }, orIgnore: () => builder, execute: jest.fn() };
  const manager = { getRepository: entity => entity === Company ? companyRepo : entity === Integration ? integrations : entity === UserCompany ? links : entity === AdvisorSale ? { createQueryBuilder: () => builder } : null };
  const db = { transaction: jest.fn(async work => work(manager)) };
  const service = new AdminService(db as never, { findByNit: async () => null } as never, { findById: async () => plan } as never, {} as never,
    { normalizeDocumentTypes: values => values ?? [], resolveIncludedDocumentTypes: () => [] } as never, {} as never, {} as never, {} as never);
  const input = { name: 'Cliente', nit: '900123456', registrationEmail: 'client@example.com', personType: CompanyPersonType.LEGAL_ENTITY,
    integrations: [IntegrationProvider.SIIGO], siigoPlanId: 'plan', includedDocumentTypes: [ElectronicDocumentType.SUPPORT_DOCUMENT], commercial: 'Forged owner' };
  return { service, input, advisor, plan, links, db, companyRepo, sale: () => sale };
}
it('reuses company creation, assigning the advisor without granting operational company membership', async () => {
  const f = setup(); const result = await f.service.createCompany(f.input, 'advisor-user', f.advisor);
  expect(result.company).toMatchObject({ advisorId: 'advisor', commercial: 'Laura', registrationEmail: 'client@example.com' });
  expect(f.links.findOne).not.toHaveBeenCalled(); expect(f.links.save).not.toHaveBeenCalled();
  expect(f.sale()).toMatchObject({ advisorId: 'advisor', priceCop: '100000.00', commissionRate: '15.00', commissionCop: '15000.00', paidAt: null });
});
it('rejects unconfigured prices/classes and Bold before creating a company', async () => {
  const f = setup(); f.plan.commissionClass = null as never;
  await expect(f.service.createCompany(f.input, 'advisor-user', f.advisor)).rejects.toThrow('clase'); expect(f.db.transaction).not.toHaveBeenCalled();
  await expect(f.service.createCompany({ ...f.input, integrations: [IntegrationProvider.BOLD] }, 'advisor-user', f.advisor)).rejects.toThrow('Siigo o Jarvis');
  expect(f.companyRepo.save).not.toHaveBeenCalled();
});
