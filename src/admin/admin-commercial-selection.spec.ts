import { AdminService } from './admin.service';
import { Company } from '../company/entities/company.entity';
import { Integration } from '../integration/entities/integration.entity';
import { Plan } from '../plan/entities/plan.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { SubscriptionStatus } from '../plan/enums/subscription-status.enum';

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-20T15:00:00Z')); });
afterEach(() => jest.useRealTimers());

function setup(unstarted = false) {
  const initialDate = new Date('2026-01-01T00:00:00Z');
  let company = { id: 'company-a', nit: '900123456', nextPymeToken: 'company-token', name: 'Empresa A', createdAt: initialDate, jarvisModules: ['BILLING'], billingMonths: 1, integrations: [] };
  const oldPlan = { id: 'old', provider: 'JARVIS', documentLimit: 25, commercialTerms: { priceCop: 139900, modules: ['BILLING'], billingMonths: 12, employeeLimit: null } };
  let integration = { id: 'integration-a', companyId: 'company-a', provider: 'JARVIS', active: true, planId: oldPlan.id, plan: oldPlan, commercialTopUps: [], subscriptionStatus: unstarted ? null : 'SUSPENDED', subscriptionStartedAt: unstarted ? null : initialDate };
  const plan = { id: 'combo', provider: 'JARVIS', documentLimit: 50, commercialTerms: { priceCop: 230000, modules: ['BILLING','PAYROLL'], billingMonths: 12, employeeLimit: 2 } };
  const companySave = jest.fn();
  const integrationSave = jest.fn();
  const findIntegration = jest.fn();
  const findPlan = jest.fn(async ({ where }) => where.id === oldPlan.id ? oldPlan : where.id === plan.id ? plan : null);
  const transaction = jest.fn(async work => {
    const draftCompany = structuredClone(company);
    const draftIntegration = structuredClone(integration);
    findIntegration.mockResolvedValue(draftIntegration);
    const result = await work({ getRepository: entity => entity === Company ? {
      findOne: jest.fn().mockResolvedValue(draftCompany), save: companySave,
    } : entity === Integration ? { findOne: findIntegration, save: integrationSave, update: jest.fn(async (_id, patch) => Object.assign(draftIntegration, patch)) } : entity === Plan ? { findOne: findPlan } : {} });
    draftIntegration.planId = draftIntegration.plan.id;
    company = draftCompany; integration = draftIntegration;
    return result;
  });
  const nextPyme = { assignDocumentPackage: jest.fn().mockResolvedValue({ success: true }), getCertificateTerm: jest.fn().mockResolvedValue({ startsAt: initialDate.toISOString(), endsAt: '2027-01-01T00:00:00.000Z', checkedAt: '2026-11-19T12:00:00.000Z' }) };
  const service = new AdminService({ transaction } as never,
    { findAllWithIntegrations: jest.fn(async () => [{ ...company, integrations: [integration] }]), findByNit: jest.fn().mockResolvedValue({ nextPymeToken: "root-token" }), findById: jest.fn(async id => id === company.id ? company : null) } as never, { findById: jest.fn(async id => id === plan.id ? plan : id === oldPlan.id ? oldPlan : null) } as never,
    { findByCompanyAndProviderWithPlan: jest.fn(async () => integration), findAllByCompanyId: jest.fn(async id => id === company.id ? [integration] : []) } as never,
    { resolveIncludedDocumentTypes: () => [], getSubscription: async () => ({ documentLimit: 50, documentsUsed: 7, remaining: 43 }) } as never,
    {} as never, {} as never, nextPyme as never);
  return { service, companySave, integrationSave, findIntegration, findPlan, nextPyme, initialDate, plan };
}

it('registrar el pago reasigna el plan con un ciclo nuevo y registra el valor sin duplicar la renovación', async () => {
  const { service, nextPyme, integrationSave } = setup();
  const before = await service.companyDetails('company-a');
  const request = { billingMonths: 1, paymentReceived: true, expectedDueDate: before.company.subscriptionDueDate, expectedJarvisCycleId: null };
  const paid = await service.updateCompanyTracking('company-a', request);
  expect(paid.company.billingMonths).toBe(12);
  expect(paid.company.integrations[0].jarvisDocumentCycle).toMatchObject({ id: expect.any(String), startedAt: '2026-11-20T15:00:00.000Z' });
  expect(integrationSave).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'ACTIVE', commercialTopUps: [], pendingInitialDocuments: 26 }));
  expect(nextPyme.getCertificateTerm).toHaveBeenCalledTimes(1);
  expect(nextPyme.assignDocumentPackage).toHaveBeenCalledWith(expect.objectContaining({ absolut_documents: 26 }), 'root-token');
  expect((await service.companyDetails('company-a')).activity).toEqual([expect.objectContaining({ kind: 'PAYMENT', amountCop: 139900, provider: 'JARVIS' })]);
  await expect(service.updateCompanyTracking('company-a', request)).rejects.toThrow();
  expect(nextPyme.getCertificateTerm).toHaveBeenCalledTimes(1);
  expect(nextPyme.assignDocumentPackage).toHaveBeenCalledTimes(1);
});

it('un pago no activa documentos si el certificado consultado sigue vencido', async () => {
  const { service, nextPyme, integrationSave } = setup();
  const before = await service.companyDetails('company-a');
  nextPyme.getCertificateTerm.mockResolvedValueOnce({ startsAt: '2024-01-01T00:00:00Z', endsAt: '2025-01-01T00:00:00Z', checkedAt: '2026-11-20T15:00:00Z' });
  await expect(service.updateCompanyTracking('company-a', { billingMonths: 12, paymentReceived: true, expectedDueDate: before.company.subscriptionDueDate })).rejects.toThrow('certificado digital');
  expect(integrationSave).not.toHaveBeenCalled();
  expect(nextPyme.assignDocumentPackage).not.toHaveBeenCalled();
  expect((await service.companyDetails('company-a')).activity).toEqual([]);
});

it.each([false, true])('edita solo recargas con el plan guardado y conserva módulos, período y suscripción (sin iniciar: %s)', async unstarted => {
  const { service, companySave, integrationSave, findPlan, initialDate } = setup(unstarted);
  const result = await service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { topUpCodes: ['documents_100'] }, 'admin');
  expect(findPlan).toHaveBeenLastCalledWith({ where: { id: 'old' } });
  expect(result.integration.plan?.id).toBe('old');
  expect(result.integration.commercialTopUps?.map(item => item.priceCop)).toEqual([149900]);
  expect(result.company).toMatchObject({ billingMonths: 1, jarvisModules: ['BILLING'] });
  expect(companySave).not.toHaveBeenCalled();
  expect(integrationSave).toHaveBeenCalledWith(expect.objectContaining({
    subscriptionStatus: unstarted ? null : 'SUSPENDED', subscriptionStartedAt: unstarted ? null : initialDate,
  }));
  const cleared = await service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { topUpCodes: [] }, 'admin');
  expect(cleared.integration.commercialTopUps).toEqual([]);
  expect(cleared.integration.plan?.id).toBe('old');
});

it('valida una recarga contra el plan actual sin cambiarlo ni habilitar otros módulos', async () => {
  const { service, companySave, integrationSave } = setup();
  await expect(service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { topUpCodes: ['payroll_5'] }, 'admin')).rejects.toThrow();
  expect(companySave).not.toHaveBeenCalled();
  expect(integrationSave).not.toHaveBeenCalled();
});

it('edita plan y recargas de una empresa en una transacción sin renovar ni activar una suscripción suspendida', async () => {
  const { service, companySave, integrationSave, findIntegration, nextPyme } = setup();
  const result = await service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { planId: 'combo', topUpCodes: ['documents_100', 'payroll_5'] }, 'admin');
  expect(result.company).toMatchObject({ id: 'company-a', billingMonths: 12, jarvisModules: ['BILLING','PAYROLL'] });
  expect(result.integration.plan?.commercialTerms?.priceCop).toBe(230000);
  expect(result.integration.commercialTopUps?.map(item => item.priceCop)).toEqual([]);
  expect(integrationSave).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'ACTIVE', subscriptionStartedAt: expect.any(Date) }));
  expect(findIntegration).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 'company-a', provider: 'JARVIS', active: true } }));
  expect(companySave).toHaveBeenCalledTimes(1);
  expect(nextPyme.assignDocumentPackage).toHaveBeenCalledWith(expect.objectContaining({ absolut_documents: 51 }), 'root-token');
});

it('permite quitar una recarga sin cambiar el precio del plan y conserva ambos cambios al consultar la empresa', async () => {
  const { service } = setup();
  await service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { planId: 'combo', topUpCodes: ['documents_10'] }, 'admin');
  const result = await service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { planId: 'combo', topUpCodes: [] }, 'admin');
  expect(result.integration.commercialTopUps).toEqual([]);
  expect(result.integration.plan?.commercialTerms?.priceCop).toBe(230000);
  expect(result.company?.integrations[0].commercialTopUps).toEqual([]);
});

it('rechaza recargas desconocidas antes de guardar plan, empresa o integración', async () => {
  const { service, integrationSave, companySave } = setup();
  await expect(service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { planId: 'combo', topUpCodes: ['unknown'] }, 'admin')).rejects.toThrow('no corresponde');
  expect(integrationSave).not.toHaveBeenCalled();
  expect(companySave).not.toHaveBeenCalled();
});

it('rechaza una recarga de Jarvis en otra integración y no combina la edición con una renovación', async () => {
  const { service, integrationSave } = setup();
  await expect(service.updateIntegrationSubscription('company-a', IntegrationProvider.SIIGO, { planId: 'combo', topUpCodes: [] }, 'admin')).rejects.toThrow('solo aplican');
  await expect(service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { planId: 'combo', topUpCodes: [], subscriptionStatus: SubscriptionStatus.ACTIVE }, 'admin')).rejects.toThrow('no modifica');
  expect(integrationSave).not.toHaveBeenCalled();
});

it('consulta el certificado en cada asignación, incluso al seleccionar otra vez el mismo plan, y nunca al cambiar solo recargas', async () => {
  const { service, nextPyme } = setup();
  const first = await service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { planId: 'combo', topUpCodes: [] }, 'admin');
  expect(nextPyme.getCertificateTerm).toHaveBeenCalledTimes(1);
  expect(nextPyme.getCertificateTerm).toHaveBeenCalledWith('900123456', 'company-token');
  const topUp = await service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { topUpCodes: ['documents_10'] }, 'admin');
  expect(nextPyme.getCertificateTerm).toHaveBeenCalledTimes(1);
  expect(topUp.integration.jarvisCertificateTerm).toEqual(first.integration.jarvisCertificateTerm);
  const renewed = { startsAt: '2027-01-01T00:00:00.000Z', endsAt: '2028-01-01T00:00:00.000Z', checkedAt: '2027-01-01T12:00:00.000Z' };
  nextPyme.getCertificateTerm.mockResolvedValueOnce(renewed);
  const result = await service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { planId: 'combo', topUpCodes: [] }, 'admin');
  expect(nextPyme.getCertificateTerm).toHaveBeenCalledTimes(2);
  expect(result.integration.jarvisCertificateTerm).toEqual(renewed);
  expect(result.integration.subscriptionStartedAt).toBe(renewed.startsAt);
});

it('conserva el plan y las fechas guardadas si NextPyme falla al reasignar', async () => {
  const { service, nextPyme, integrationSave, companySave } = setup();
  nextPyme.getCertificateTerm.mockRejectedValueOnce(new Error('Servicio no disponible'));
  await expect(service.updateIntegrationSubscription('company-a', IntegrationProvider.JARVIS, { planId: 'combo', topUpCodes: [] }, 'admin')).rejects.toThrow('Servicio no disponible');
  expect(integrationSave).not.toHaveBeenCalled();
  expect(companySave).not.toHaveBeenCalled();
});
