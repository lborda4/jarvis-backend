import { AdminService } from './admin.service';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { SubscriptionStatus } from '../plan/enums/subscription-status.enum';

function setup(provider = IntegrationProvider.JARVIS) {
  const term = { startsAt: '2026-01-01T15:00:00Z', endsAt: '2027-01-01T15:00:00Z', checkedAt: '2026-06-01T12:00:00Z' };
  const plan = { id: 'plan', provider };
  const integration = { id: 'integration', provider, plan, subscriptionStartedAt: new Date('2026-06-01T12:00:00Z') };
  const subscriptions = { resolveIncludedDocumentTypes: () => [], assignPlan: jest.fn().mockResolvedValue(integration), updateSubscriptionStatus: jest.fn() };
  const client = { getCertificateTerm: jest.fn().mockResolvedValue(term) };
  const service = new AdminService({} as never,
    { findById: async () => ({ nit: '900123456', nextPymeToken: 'company-token' }) } as never,
    { findById: async () => plan } as never,
    { findByCompanyAndProviderWithPlan: async () => integration } as never,
    subscriptions as never, {} as never, {} as never, client as never);
  return { service, subscriptions, client, term };
}

it('también consulta al asignar un plan Jarvis por el endpoint sin selección de recargas', async () => {
  const { service, subscriptions, client, term } = setup();
  await service.updateIntegrationSubscription('company', IntegrationProvider.JARVIS, { planId: 'plan' }, 'admin');
  expect(client.getCertificateTerm).toHaveBeenCalledTimes(1);
  expect(subscriptions.assignPlan).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan', jarvisCertificateTerm: term }));
});

it('suspender o activar la suscripción no consulta el certificado', async () => {
  const { service, subscriptions, client } = setup();
  await service.updateIntegrationSubscription('company', IntegrationProvider.JARVIS, { subscriptionStatus: SubscriptionStatus.SUSPENDED }, 'admin');
  expect(client.getCertificateTerm).not.toHaveBeenCalled();
  expect(subscriptions.updateSubscriptionStatus).toHaveBeenCalled();
});

it('asignar un plan SIIGO conserva su comportamiento y no consulta certificados', async () => {
  const { service, subscriptions, client } = setup(IntegrationProvider.SIIGO);
  await service.updateIntegrationSubscription('company', IntegrationProvider.SIIGO, { planId: 'plan' }, 'admin');
  expect(client.getCertificateTerm).not.toHaveBeenCalled();
  expect(subscriptions.assignPlan).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan', jarvisCertificateTerm: undefined }));
});
