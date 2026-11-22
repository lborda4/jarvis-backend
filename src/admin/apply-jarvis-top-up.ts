import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Company } from '../company/entities/company.entity';
import { Integration } from '../integration/entities/integration.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { NextPymePackageRejectedException } from '../integration/jarvis/nextpyme/nextpyme-api.client';
import { Plan } from '../plan/entities/plan.entity';
import { SubscriptionStatus } from '../plan/enums/subscription-status.enum';
import { jarvisSubscriptionPeriod, type JarvisTopUpOperation } from '../plan/jarvis-subscription';
import { resolveJarvisTopUps } from '../plan/jarvis-top-ups';
import { recordAdvisorSale } from '../advisor/advisor-commission';
import { AdvisorSale } from '../advisor/advisor-sale.entity';

export interface ApplyJarvisTopUpRequest { operationId: string; topUpCodes: string[]; }

/** Persist the attempt BEFORE HTTP. An uncertain result must never automatically send a second package. */
export async function applyJarvisTopUp(db: DataSource, companyId: string, request: ApplyJarvisTopUpRequest,
  assign: (documents: number) => Promise<unknown>, basePackageCycleId?: string): Promise<JarvisTopUpOperation> {
  if (typeof request?.operationId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(request.operationId))
    throw new BadRequestException('Identificador de recarga inválido.');
  if (!Array.isArray(request.topUpCodes) || (!request.topUpCodes.length && !basePackageCycleId))
    throw new BadRequestException('Selecciona una recarga.');
  let send = false;
  let tracksAdvisorSale = false;
  const operation = await db.transaction(async manager => {
    const company = await manager.getRepository(Company).findOne({ where: { id: companyId }, lock: { mode: 'pessimistic_write' } });
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    const repository = manager.getRepository(Integration);
    const integration = await repository.findOne({ where: { companyId, provider: IntegrationProvider.JARVIS, active: true }, lock: { mode: 'pessimistic_write' } });
    if (!integration) throw new NotFoundException('La empresa no tiene integración Jarvis.');
    const operations = integration.topUpOperations ?? [];
    const existing = operations.find(item => item.id === request.operationId);
    if (existing) {
      if (existing.topUps.map(item => item.code).sort().join(',') !== [...request.topUpCodes].sort().join(','))
        throw new ConflictException('Este identificador ya corresponde a otra recarga.');
      // FAILED also requires a new operation: retries of the same request always return the saved result.
      return existing;
    }
    if (basePackageCycleId && integration.jarvisDocumentCycle?.id !== basePackageCycleId)
      throw new ConflictException('El período del plan cambió antes de asignar su paquete inicial.');
    if (operations.some(item => (!integration.jarvisDocumentCycle || item.cycleId === integration.jarvisDocumentCycle.id) && (item.status === 'PROCESSING' || item.status === 'UNCERTAIN')))
      throw new ConflictException('Hay una recarga pendiente de confirmar. Consulta su saldo en NextPyme antes de aplicar otra.');
    if (!integration.planId) throw new BadRequestException('La empresa no tiene un plan Jarvis asignado.');
    const plan = await manager.getRepository(Plan).findOne({ where: { id: integration.planId } });
    if (!plan || plan.provider !== IntegrationProvider.JARVIS) throw new BadRequestException('La empresa no tiene un plan Jarvis válido.');
    integration.plan = plan;
    integration.company = company;
    const period = jarvisSubscriptionPeriod(integration);
    if (integration.subscriptionStatus !== SubscriptionStatus.ACTIVE || period.expired || period.notStarted)
      throw new BadRequestException('La suscripción debe estar activa y vigente para recargar.');
    const topUps = resolveJarvisTopUps(plan, request.topUpCodes);
    if ((basePackageCycleId || topUps.some(item => item.kind === 'DOCUMENTS')) && !company.nextPymeToken?.trim())
      throw new BadRequestException('Configura el token de NextPyme de la empresa antes de recargar documentos.');
    const next: JarvisTopUpOperation = { id: request.operationId, topUps, periodStart: period.key, status: 'PROCESSING', createdAt: new Date().toISOString(),
      cycleId: integration.jarvisDocumentCycle?.id,
      initialDocuments: basePackageCycleId || topUps.some(item => item.kind === 'DOCUMENTS') ? integration.pendingInitialDocuments ?? 0 : 0 };
    integration.topUpOperations = [...operations, next];
    await recordAdvisorSale(manager, company, plan, `topup-${next.id}`, { plan: false, topUps, activation: 'PROCESSING' });
    tracksAdvisorSale = Boolean(company.advisorId && topUps.length);
    // Save only this field: never overwrite a plan or credentials from a concurrent operation.
    await repository.update(integration.id, { topUpOperations: integration.topUpOperations });
    send = true;
    return next;
  });
  if (!send) return operation;
  const documents = operation.topUps.filter(item => item.kind === 'DOCUMENTS').reduce((sum, item) => sum + item.units, 0);
  let status: JarvisTopUpOperation['status'] = 'APPLIED';
  try {
    if (documents + (operation.initialDocuments ?? 0) > 0) await assign(documents + (operation.initialDocuments ?? 0));
  } catch (error) {
    status = error instanceof NextPymePackageRejectedException || error instanceof BadRequestException ? 'FAILED' : 'UNCERTAIN';
  }
  return db.transaction(async manager => {
    const repository = manager.getRepository(Integration);
    const integration = await repository.findOne({ where: { companyId, provider: IntegrationProvider.JARVIS }, lock: { mode: 'pessimistic_write' } });
    if (!integration) throw new NotFoundException('Integración no encontrada al confirmar la recarga.');
    const operations = integration.topUpOperations ?? [];
    const saved = operations.find(item => item.id === operation.id);
    if (!saved) throw new ConflictException('No se encontró el registro de la recarga.');
    if (saved.status !== 'PROCESSING') return saved;
    saved.status = status;
    if (tracksAdvisorSale) await manager.getRepository(AdvisorSale).update({ companyId, operationKey: `topup-${operation.id}` }, { activation: status });
    await repository.update(integration.id, { topUpOperations: operations,
      ...(status === 'APPLIED' && operation.initialDocuments && operation.cycleId === integration.jarvisDocumentCycle?.id ? { pendingInitialDocuments: 0 } : {}),
    });
    return saved;
  });
}
