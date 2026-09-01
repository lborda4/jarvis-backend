import { ForbiddenException } from '@nestjs/common';
import { ElectronicDocumentType } from '../electronic-document/enums/electronic-document-type.enum';
import { Integration } from '../integration/entities/integration.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { SubscriptionStatus } from './enums/subscription-status.enum';
import { PlanSubscriptionService } from './plan-subscription.service';

const COMPANY_ID = 'company-1';

function buildIntegration(overrides: Partial<Integration> = {}): Integration {
  return {
    id: 'integration-1',
    companyId: COMPANY_ID,
    provider: IntegrationProvider.SIIGO,
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    subscriptionStartedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    includedDocumentTypes: [ElectronicDocumentType.PURCHASE_INVOICE],
    plan: {
      id: 'plan-1',
      documentLimit: 100,
      includedDocumentTypes: [ElectronicDocumentType.PURCHASE_INVOICE],
    },
    ...overrides,
  } as Integration;
}

function buildService(
  integration: Integration | null,
  documentsUsed: number,
): PlanSubscriptionService {
  const integrationsRepository = {
    findByCompanyAndProviderWithPlan: jest.fn().mockResolvedValue(integration),
  };
  const electronicDocumentsRepositoryQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(documentsUsed),
  };
  const electronicDocumentsRepository = {
    createQueryBuilder: jest
      .fn()
      .mockReturnValue(electronicDocumentsRepositoryQueryBuilder),
  };

  return new PlanSubscriptionService(
    {} as any,
    integrationsRepository as any,
    electronicDocumentsRepository as any,
  );
}

describe('PlanSubscriptionService.resolveAllowedQuantity', () => {
  it('permite el lote completo cuando cabe en el cupo restante', async () => {
    const service = buildService(buildIntegration(), 0);

    const result = await service.resolveAllowedQuantity({
      companyId: COMPANY_ID,
      provider: IntegrationProvider.SIIGO,
      documentType: ElectronicDocumentType.PURCHASE_INVOICE,
      requestedQuantity: 40,
    });

    expect(result).toEqual({ allowed: 40, documentLimit: 100, documentsUsed: 0 });
  });

  it('caso reportado: plan de 100, usados 0, se piden 500 → permite solo 100 (no 0, no 500)', async () => {
    const service = buildService(buildIntegration(), 0);

    const result = await service.resolveAllowedQuantity({
      companyId: COMPANY_ID,
      provider: IntegrationProvider.SIIGO,
      documentType: ElectronicDocumentType.PURCHASE_INVOICE,
      requestedQuantity: 500,
    });

    expect(result).toEqual({ allowed: 100, documentLimit: 100, documentsUsed: 0 });
  });

  it('descuenta lo ya usado del cupo restante', async () => {
    const service = buildService(buildIntegration(), 70);

    const result = await service.resolveAllowedQuantity({
      companyId: COMPANY_ID,
      provider: IntegrationProvider.SIIGO,
      documentType: ElectronicDocumentType.PURCHASE_INVOICE,
      requestedQuantity: 500,
    });

    expect(result).toEqual({ allowed: 30, documentLimit: 100, documentsUsed: 70 });
  });

  it('devuelve 0 (no negativo) cuando ya no queda cupo', async () => {
    const service = buildService(buildIntegration(), 100);

    const result = await service.resolveAllowedQuantity({
      companyId: COMPANY_ID,
      provider: IntegrationProvider.SIIGO,
      documentType: ElectronicDocumentType.PURCHASE_INVOICE,
      requestedQuantity: 10,
    });

    expect(result).toEqual({ allowed: 0, documentLimit: 100, documentsUsed: 100 });
  });

  it('plan sin límite (documentLimit null): permite todo el lote sin contar documentos usados', async () => {
    const service = buildService(
      buildIntegration({ plan: { id: 'plan-1', documentLimit: null, includedDocumentTypes: [ElectronicDocumentType.PURCHASE_INVOICE] } as any }),
      0,
    );

    const result = await service.resolveAllowedQuantity({
      companyId: COMPANY_ID,
      provider: IntegrationProvider.SIIGO,
      documentType: ElectronicDocumentType.PURCHASE_INVOICE,
      requestedQuantity: 500,
    });

    expect(result).toEqual({ allowed: 500, documentLimit: null, documentsUsed: 0 });
  });

  it('lanza ForbiddenException si la integración no tiene plan activo', async () => {
    const service = buildService(null, 0);

    await expect(
      service.resolveAllowedQuantity({
        companyId: COMPANY_ID,
        provider: IntegrationProvider.SIIGO,
        documentType: ElectronicDocumentType.PURCHASE_INVOICE,
        requestedQuantity: 10,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lanza ForbiddenException si la suscripción está suspendida', async () => {
    const service = buildService(
      buildIntegration({ subscriptionStatus: SubscriptionStatus.SUSPENDED }),
      0,
    );

    await expect(
      service.resolveAllowedQuantity({
        companyId: COMPANY_ID,
        provider: IntegrationProvider.SIIGO,
        documentType: ElectronicDocumentType.PURCHASE_INVOICE,
        requestedQuantity: 10,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lanza ForbiddenException si el tipo de documento no está incluido en la suscripción', async () => {
    const service = buildService(
      buildIntegration({ includedDocumentTypes: [ElectronicDocumentType.SUPPORT_DOCUMENT] }),
      0,
    );

    await expect(
      service.resolveAllowedQuantity({
        companyId: COMPANY_ID,
        provider: IntegrationProvider.SIIGO,
        documentType: ElectronicDocumentType.PURCHASE_INVOICE,
        requestedQuantity: 10,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('PlanSubscriptionService.assertCanCreateDocuments', () => {
  it('no lanza cuando el lote completo cabe en el cupo', async () => {
    const service = buildService(buildIntegration(), 0);

    await expect(
      service.assertCanCreateDocuments({
        companyId: COMPANY_ID,
        provider: IntegrationProvider.SIIGO,
        documentType: ElectronicDocumentType.PURCHASE_INVOICE,
        quantity: 50,
      }),
    ).resolves.toBeUndefined();
  });

  it('[CANARIO] mensaje preciso: "usados: 0" pero igual bloquea porque lo solicitado excede el límite total — el mensaje debe decir cuánto se pidió y cuánto hay disponible, no solo "usados"', async () => {
    const service = buildService(buildIntegration(), 0);

    await expect(
      service.assertCanCreateDocuments({
        companyId: COMPANY_ID,
        provider: IntegrationProvider.SIIGO,
        documentType: ElectronicDocumentType.PURCHASE_INVOICE,
        quantity: 500,
      }),
    ).rejects.toThrow(
      'Ha alcanzado el límite del plan (100 documentos). Usados: 0, disponibles: 100, solicitados: 500.',
    );
  });

  it('lanza cuando el lote excede el cupo restante (usados > 0)', async () => {
    const service = buildService(buildIntegration(), 70);

    await expect(
      service.assertCanCreateDocuments({
        companyId: COMPANY_ID,
        provider: IntegrationProvider.SIIGO,
        documentType: ElectronicDocumentType.PURCHASE_INVOICE,
        quantity: 50,
      }),
    ).rejects.toThrow(
      'Ha alcanzado el límite del plan (100 documentos). Usados: 70, disponibles: 30, solicitados: 50.',
    );
  });
});
