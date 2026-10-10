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

function buildJarvisSalesRepository(documentsUsed = 0) {
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(documentsUsed),
  };
  return {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    queryBuilder,
  };
}

function buildService(
  integration: Integration | null,
  documentsUsed: number,
  salesDocumentsUsed = 0,
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
    buildJarvisSalesRepository(salesDocumentsUsed) as any,
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

describe('cupos manuales independientes de Siigo', () => {
  const limits = { PURCHASE_INVOICE: 100, SUPPORT_DOCUMENT: 50 };
  const integration = () => buildIntegration({ plan: null, documentLimits: limits, includedDocumentTypes: [ElectronicDocumentType.PURCHASE_INVOICE, ElectronicDocumentType.SUPPORT_DOCUMENT] });
  it.each([[ElectronicDocumentType.PURCHASE_INVOICE, 100, 90], [ElectronicDocumentType.SUPPORT_DOCUMENT, 50, 40]])('usa su propio cupo sin plan del catalogo: %s', async (documentType, documentLimit, allowed) => {
    const service = buildService(integration(), 10);
    expect(await service.resolveAllowedQuantity({ companyId: COMPANY_ID, provider: IntegrationProvider.SIIGO, documentType, requestedQuantity: 200 })).toEqual({ documentLimit, documentsUsed: 10, allowed });
  });
  it('agotar soporte no bloquea facturas', async () => {
    const service = buildService(integration(), 50);
    await expect(service.assertCanCreateDocuments({ companyId: COMPANY_ID, provider: IntegrationProvider.SIIGO, documentType: ElectronicDocumentType.SUPPORT_DOCUMENT, quantity: 1 })).rejects.toThrow(ForbiddenException);
    await expect(service.assertCanCreateDocuments({ companyId: COMPANY_ID, provider: IntegrationProvider.SIIGO, documentType: ElectronicDocumentType.PURCHASE_INVOICE, quantity: 1 })).resolves.toBeUndefined();
  });
  it('devuelve ambos contadores sin mezclar los consumos', async () => {
    const queries: any[] = [];
    const repo = { createQueryBuilder: () => {
      let type: string;
      const query = { where: jest.fn().mockReturnThis(), andWhere: jest.fn((sql, params) => { if (params.documentType) type = params.documentType; return query; }), getCount: jest.fn(async () => type === 'PURCHASE_INVOICE' ? 20 : 5) };
      queries.push(query); return query;
    } };
    const service = new PlanSubscriptionService({} as never, { findByCompanyAndProviderWithPlan: jest.fn().mockResolvedValue(integration()) } as never, repo as never, buildJarvisSalesRepository() as never);
    const snapshot = await service.getSubscription(COMPANY_ID, IntegrationProvider.SIIGO);
    expect(snapshot.documentQuotas).toEqual({ PURCHASE_INVOICE: {documentLimit: 100, documentsUsed: 20, remaining: 80}, SUPPORT_DOCUMENT: {documentLimit: 50, documentsUsed: 5, remaining: 45} });
    expect(snapshot.remaining).toBe(125);
    for (const query of queries) expect(query.andWhere).toHaveBeenCalledWith('document.alreadyInSiigo = :alreadyInSiigo', { alreadyInSiigo: false });
    for (const query of queries) expect(query.andWhere).toHaveBeenCalledWith('document.status = :status', {status: 'PURCHASE_CREATED'});
  });
  it.each([-1, 1.5, undefined, '100'])('rechaza cupos invalidos: %s', async value => {
    const service = buildService(integration(), 0);
    await expect(service.saveSiigoDocumentLimits(COMPANY_ID, {purchaseInvoice: value as any, supportDocument: 50})).rejects.toThrow('enteros');
  });
  it('cupo cero bloquea e ilimitado permite solamente su tipo', async () => {
    const service = buildService(buildIntegration({ documentLimits: { PURCHASE_INVOICE: 0, SUPPORT_DOCUMENT: null }, includedDocumentTypes: [ElectronicDocumentType.PURCHASE_INVOICE, ElectronicDocumentType.SUPPORT_DOCUMENT] }), 0);
    await expect(service.assertCanCreateDocuments({ companyId: COMPANY_ID, provider: IntegrationProvider.SIIGO, documentType: ElectronicDocumentType.PURCHASE_INVOICE, quantity: 1 })).rejects.toThrow();
    expect((await service.resolveAllowedQuantity({ companyId: COMPANY_ID, provider: IntegrationProvider.SIIGO, documentType: ElectronicDocumentType.SUPPORT_DOCUMENT, requestedQuantity: 500 })).allowed).toBe(500);
  });
  it('no aplica los cupos manuales de Siigo a Jarvis', async () => {
    const service = buildService(buildIntegration({ provider: IntegrationProvider.JARVIS, documentLimits: { PURCHASE_INVOICE: 1 } }), 10);
    expect((await service.resolveAllowedQuantity({ companyId: COMPANY_ID, provider: IntegrationProvider.JARVIS, documentType: ElectronicDocumentType.PURCHASE_INVOICE, requestedQuantity: 100 })).allowed).toBe(90);
  });
});

describe('cupo compartido Jarvis', () => {
  const jarvis = () =>
    buildIntegration({
      provider: IntegrationProvider.JARVIS,
      includedDocumentTypes: [ElectronicDocumentType.SUPPORT_DOCUMENT],
    });

  it('suma documentos soporte y facturas de venta en el mismo pozo', async () => {
    const service = buildService(jarvis(), 7, 5);

    const result = await service.resolveAllowedQuantity({
      companyId: COMPANY_ID,
      provider: IntegrationProvider.JARVIS,
      documentType: ElectronicDocumentType.SUPPORT_DOCUMENT,
      requestedQuantity: 100,
    });

    expect(result).toEqual({ allowed: 88, documentLimit: 100, documentsUsed: 12 });
  });

  it('bloquea el envío cuando el cupo se acabó', async () => {
    const service = buildService(jarvis(), 60, 40);

    await expect(
      service.assertCanCreateDocuments({
        companyId: COMPANY_ID,
        provider: IntegrationProvider.JARVIS,
        documentType: ElectronicDocumentType.PURCHASE_INVOICE,
        quantity: 1,
      }),
    ).rejects.toThrow(
      'Se le acabaron los documentos disponibles del plan. Ya no puede enviar documentos soporte ni facturas de venta.',
    );
  });

  it('avisa al 10% restante y cuando se agotó', async () => {
    const service = buildService(jarvis(), 0);

    expect(service.buildJarvisQuotaNotice(100, 90, 10)).toEqual({
      code: 'LOW',
      message: 'Le quedan 10 de 100 documentos disponibles. Se le están acabando.',
      remaining: 10,
      documentLimit: 100,
      documentsUsed: 90,
    });
    expect(service.buildJarvisQuotaNotice(100, 100, 0)).toMatchObject({
      code: 'EXHAUSTED',
      message: 'Se le acabaron los documentos disponibles del plan.',
    });
    expect(service.buildJarvisQuotaNotice(100, 50, 50)).toBeNull();
  });

  it('expone el aviso en el snapshot de suscripción', async () => {
    const service = buildService(jarvis(), 91, 0);
    const snapshot = await service.getSubscription(COMPANY_ID, IntegrationProvider.JARVIS);
    expect(snapshot.documentsUsed).toBe(91);
    expect(snapshot.remaining).toBe(9);
    expect(snapshot.quotaNotice?.code).toBe('LOW');
  });
});
