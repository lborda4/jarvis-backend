import { BadGatewayException } from '@nestjs/common';
import { Company } from '../company/entities/company.entity';
import { Integration } from '../integration/entities/integration.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { NextPymePackageRejectedException } from '../integration/jarvis/nextpyme/nextpyme-api.client';
import { Plan } from '../plan/entities/plan.entity';
import { jarvisDocumentLimit } from '../plan/jarvis-subscription';
import { applyJarvisTopUp } from './apply-jarvis-top-up';

beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date('2026-06-01T12:00:00Z')); });
afterEach(() => jest.useRealTimers());

function setup() {
  const start = new Date('2026-01-01T12:00:00Z');
  const company = { id: 'company', createdAt: start, nextPymeToken: 'company-token', billingMonths: 12, trackingPeriodStart: null };
  const plan = { id: 'plan', provider: 'JARVIS', documentLimit: 50, commercialTerms: { billingMonths: 12, modules: ['BILLING', 'PAYROLL'], employeeLimit: 2 } };
  let integration = { id: 'integration', companyId: 'company', provider: 'JARVIS', planId: 'plan', active: true,
    subscriptionStartedAt: start, subscriptionStatus: 'ACTIVE', topUpOperations: [] } as unknown as Integration;
  let inTransaction = false;
  let queue = Promise.resolve();
  const db = { transaction: jest.fn(work => {
    const result = queue.then(async () => {
      inTransaction = true;
      const draft = structuredClone(integration);
      try {
        const result = await work({ getRepository: entity => entity === Company ? {
          findOne: async () => company,
        } : entity === Plan ? { findOne: async () => plan } : entity === Integration ? {
          findOne: async () => draft,
          update: async (_id, fields) => Object.assign(draft, fields),
        } : {} });
        integration = draft;
        return result;
      } finally { inTransaction = false; }
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  }) };
  const assign = jest.fn(async (_documents: number) => {
    expect(inTransaction).toBe(false);
    expect(integration.topUpOperations.at(-1)?.status).toBe('PROCESSING');
    return { success: true };
  });
  const apply = (id: string, codes = ['documents_100']) => applyJarvisTopUp(db as never, 'company', { operationId: id, topUpCodes: codes }, assign);
  const current = () => ({ ...integration, plan, company }) as unknown as Integration;
  return { apply, assign, current, company, plan, mutate: (fields: Partial<Integration>) => Object.assign(integration, fields) };
}

it('acumula compras sucesivas en la empresa sin cambiar el plan, el inicio, el período ni el consumo', async () => {
  const { apply, assign, current, company, plan } = setup();
  const before = structuredClone(current());
  await apply('first-operation-0001');
  await apply('second-operation-001', ['documents_10']);
  expect(assign.mock.calls.map(call => call[0])).toEqual([100, 10]);
  expect(jarvisDocumentLimit(current())).toBe(160);
  expect(plan.documentLimit).toBe(50);
  expect(company.billingMonths).toBe(12);
  expect(current().subscriptionStartedAt).toEqual(before.subscriptionStartedAt);
  expect(current().subscriptionStatus).toBe('ACTIVE');
  expect(current().topUpOperations.map(item => item.status)).toEqual(['APPLIED', 'APPLIED']);
});

it('no duplica la asignación ante reintentos concurrentes ni después de confirmar', async () => {
  const { apply, assign, current } = setup();
  await Promise.all([apply('same-operation-00001'), apply('same-operation-00001')]);
  const result = await apply('same-operation-00001');
  expect(result.status).toBe('APPLIED');
  expect(assign).toHaveBeenCalledTimes(1);
  expect(jarvisDocumentLimit(current())).toBe(150);
  await expect(apply('same-operation-00001', ['documents_10'])).rejects.toThrow('otra recarga');
});

it('incluye el paquete inicial pendiente una sola vez y no lo acredita dos veces en Jarvis', async () => {
  const { apply, assign, current, mutate } = setup();
  mutate({ pendingInitialDocuments: 51 });
  await apply('initial-operation-01');
  expect(assign).toHaveBeenLastCalledWith(151);
  expect(current().pendingInitialDocuments).toBe(0);
  expect(jarvisDocumentLimit(current())).toBe(150);
  await apply('following-operation1', ['documents_10']);
  expect(assign).toHaveBeenLastCalledWith(10);
  expect(jarvisDocumentLimit(current())).toBe(160);
});

it('un rechazo confirmado no suma crédito y devuelve el mismo resultado al reintentar', async () => {
  const { apply, assign, current } = setup();
  assign.mockRejectedValueOnce(new NextPymePackageRejectedException('HTTP 422'));
  expect((await apply('rejected-operation-01')).status).toBe('FAILED');
  expect((await apply('rejected-operation-01')).status).toBe('FAILED');
  expect(assign).toHaveBeenCalledTimes(1);
  expect(jarvisDocumentLimit(current())).toBe(50);
  expect((await apply('new-operation-000001')).status).toBe('APPLIED');
});

it('un resultado incierto no duplica paquetes ni acredita documentos sin confirmar', async () => {
  const { apply, assign, current } = setup();
  assign.mockRejectedValueOnce(new BadGatewayException('timeout'));
  expect((await apply('uncertain-operation1')).status).toBe('UNCERTAIN');
  expect((await apply('uncertain-operation1')).status).toBe('UNCERTAIN');
  await expect(apply('another-operation-01')).rejects.toThrow('pendiente');
  expect(assign).toHaveBeenCalledTimes(1);
  expect(jarvisDocumentLimit(current())).toBe(50);
});

it('rechaza compras en suscripciones vencidas o suspendidas y recargas ajenas al plan', async () => {
  const { apply, assign, mutate } = setup();
  await expect(apply('invalid-operation-01', ['unknown'])).rejects.toThrow();
  mutate({ subscriptionStatus: 'SUSPENDED' as never });
  await expect(apply('suspended-operation1')).rejects.toThrow('vigente');
  mutate({ subscriptionStatus: 'ACTIVE' as never, subscriptionStartedAt: new Date('2025-01-01T12:00:00Z') });
  await expect(apply('expired-operation-01')).rejects.toThrow('vigente');
  expect(assign).not.toHaveBeenCalled();
});

it('las recargas de empleados no se convierten en documentos ni se envían al endpoint de documentos', async () => {
  const { apply, assign, current } = setup();
  expect((await apply('payroll-operation-01', ['payroll_5'])).status).toBe('APPLIED');
  expect(jarvisDocumentLimit(current())).toBe(50);
  expect(assign).not.toHaveBeenCalled();
});

it('los créditos de un período anterior no se acreditan al renovar ni a otra empresa', async () => {
  const { apply, current, company } = setup();
  await apply('annual-operation-001');
  company.trackingPeriodStart = '2026-05-01' as never;
  expect(jarvisDocumentLimit(current())).toBe(50);
  expect(jarvisDocumentLimit({ ...current(), topUpOperations: [] })).toBe(50);
});

it('usa la vigencia guardada del certificado para recargar y conserva las compras aunque cambie el seguimiento de cobro', async () => {
  const { apply, current, mutate, company } = setup();
  const term = { startsAt: '2026-02-01T15:00:00Z', endsAt: '2027-02-01T15:00:00Z', checkedAt: '2026-02-01T16:00:00Z' };
  mutate({ jarvisCertificateTerm: term });
  await apply('certificate-topup-01');
  company.trackingPeriodStart = '2026-05-01' as never;
  expect(jarvisDocumentLimit(current())).toBe(150);
  expect(current().jarvisCertificateTerm).toEqual(term);
});

it.each([
  { startsAt: '2025-06-01T11:59:59Z', endsAt: '2026-06-01T11:59:59Z' },
  { startsAt: '2026-06-01T12:00:01Z', endsAt: '2027-06-01T12:00:01Z' },
])('no recarga fuera del inicio o vencimiento exactos del certificado: %j', term => {
  const { apply, assign, mutate } = setup();
  mutate({ jarvisCertificateTerm: { ...term, checkedAt: '2026-01-01T12:00:00Z' } });
  return expect(apply('outside-certificate1')).rejects.toThrow('vigente').then(() => {
    expect(assign).not.toHaveBeenCalled();
  });
});
