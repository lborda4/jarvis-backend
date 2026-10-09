import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { withPostgresAdvisoryLock } from '../common/helpers/postgres-advisory-lock.helper';
import { ElectronicDocument } from '../electronic-document/entities/electronic-document.entity';
import { ElectronicDocumentStatus } from '../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentType } from '../electronic-document/enums/electronic-document-type.enum';
import { Integration } from '../integration/entities/integration.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { IntegrationsRepository } from '../integration/repositories/integrations.repository';
import { Plan } from './entities/plan.entity';
import { SubscriptionStatus } from './enums/subscription-status.enum';
import { PlansRepository } from './repositories/plans.repository';

export interface DocumentQuotaSnapshot { documentLimit: number | null; documentsUsed: number; remaining: number | null; }
export interface PlanSubscriptionSnapshot {
  documentQuotas?: Partial<Record<ElectronicDocumentType, DocumentQuotaSnapshot>>;
  status: SubscriptionStatus | null;
  startedAt: string | null;
  documentLimit: number | null;
  documentsUsed: number;
  remaining: number | null;
  includedDocumentTypes: ElectronicDocumentType[];
  plan: {
    id: string;
    name: string;
    code: string;
    documentLimit: number | null;
    includedDocumentTypes: ElectronicDocumentType[];
  } | null;
}

const ALLOWED_DOCUMENT_TYPES = new Set<ElectronicDocumentType>([
  ElectronicDocumentType.SUPPORT_DOCUMENT,
  ElectronicDocumentType.PURCHASE_INVOICE,
]);

@Injectable()
export class PlanSubscriptionService {
  constructor(
    private readonly plansRepository: PlansRepository,
    @Inject(forwardRef(() => IntegrationsRepository))
    private readonly integrationsRepository: IntegrationsRepository,
    @InjectRepository(ElectronicDocument)
    private readonly electronicDocumentsRepository: Repository<ElectronicDocument>,
  ) {}
  async withSiigoQuotaLock<T>(companyId: string, work: () => Promise<T>): Promise<T> {
    return withPostgresAdvisoryLock(this.electronicDocumentsRepository.manager.connection, 'siigo-quota:' + companyId, work);
  }

  private limitFor(integration: Integration, type: ElectronicDocumentType): number | null {
    const override = integration.provider === IntegrationProvider.SIIGO ? integration.documentLimits?.[type] : undefined;
    return override !== undefined ? override : integration.plan?.documentLimit ?? null;
  }

  async saveSiigoDocumentLimits(companyId: string, limits: { purchaseInvoice: number | null; supportDocument: number | null }): Promise<PlanSubscriptionSnapshot> {
    for (const value of [limits?.purchaseInvoice, limits?.supportDocument]) {
      if (value !== null && (!Number.isSafeInteger(value) || value! < 0)) throw new BadRequestException('Los cupos deben ser enteros mayores o iguales a cero, o null para ilimitado.');
    }
    return this.withSiigoQuotaLock(companyId, async () => {
      const integration = await this.integrationsRepository.findByCompanyAndProviderWithPlan(companyId, IntegrationProvider.SIIGO);
      if (!integration) throw new NotFoundException('La empresa no tiene integración Siigo.');
      integration.includedDocumentTypes = [...ALLOWED_DOCUMENT_TYPES];
      integration.subscriptionStatus ??= SubscriptionStatus.ACTIVE;
      integration.documentLimits = { [ElectronicDocumentType.PURCHASE_INVOICE]: limits.purchaseInvoice, [ElectronicDocumentType.SUPPORT_DOCUMENT]: limits.supportDocument };
      await this.integrationsRepository.save(integration);
      return this.buildSnapshot(integration);
    });
  }

  async getSubscription(
    companyId: string,
    provider: IntegrationProvider,
  ): Promise<PlanSubscriptionSnapshot> {
    const integration =
      await this.integrationsRepository.findByCompanyAndProviderWithPlan(
        companyId,
        provider,
      );

    if (!integration) {
      return this.emptySnapshot();
    }

    return this.buildSnapshot(integration);
  }

  resolveIncludedDocumentTypes(
    integration: Integration,
  ): ElectronicDocumentType[] {
    const fromIntegration = this.normalizeDocumentTypes(
      integration.includedDocumentTypes,
    );

    if (fromIntegration.length > 0) {
      return fromIntegration;
    }

    return this.normalizeDocumentTypes(integration.plan?.includedDocumentTypes);
  }

  /**
   * Todo-o-nada: lanza ForbiddenException si `quantity` no cabe completo en
   * el cupo restante del plan. Pensado para creaciones de UN documento (o un
   * lote chico) donde no tiene sentido crear "una parte" — ver
   * resolveAllowedQuantity para el caso de lotes grandes (ej. importación
   * masiva de Factura de compra) donde sí conviene procesar hasta agotar el
   * cupo en vez de rechazar todo.
   */
  async assertCanCreateDocuments(params: {
    companyId: string;
    provider: IntegrationProvider;
    documentType: ElectronicDocumentType;
    quantity: number;
  }): Promise<void> {
    const { quantity } = params;
    const { allowed, documentLimit, documentsUsed } =
      await this.resolveAllowedQuantity({
        companyId: params.companyId,
        provider: params.provider,
        documentType: params.documentType,
        requestedQuantity: quantity,
      });

    if (allowed < quantity) {
      throw new ForbiddenException(
        this.buildLimitReachedMessage(
          documentLimit,
          documentsUsed,
          quantity,
        ),
      );
    }
  }

  /**
   * Devuelve cuántos de los `requestedQuantity` documentos pedidos caben en
   * el cupo restante del plan (0..requestedQuantity), en vez de solo
   * aceptar/rechazar todo el lote — así el llamador puede procesar hasta
   * agotar el cupo y reportar el resto como pendiente por límite de plan, en
   * vez de descartar una importación completa porque excede el límite total
   * del plan (ej. 500 filas contra un plan de 100 documentos). Sigue
   * lanzando ForbiddenException para las condiciones que SÍ son todo-o-nada
   * (sin plan activo, suscripción suspendida, tipo de documento no
   * incluido) — esas no tienen un "parcial" razonable.
   */
  async resolveAllowedQuantity(params: {
    companyId: string;
    provider: IntegrationProvider;
    documentType: ElectronicDocumentType;
    requestedQuantity: number;
  }): Promise<{
    allowed: number;
    documentLimit: number | null;
    documentsUsed: number;
  }> {
    const { companyId, provider, documentType, requestedQuantity } = params;

    const integration =
      await this.integrationsRepository.findByCompanyAndProviderWithPlan(
        companyId,
        provider,
      );

    if (!integration || (!integration.plan?.id && !(integration.provider === IntegrationProvider.SIIGO && integration.documentLimits))) {
      throw new ForbiddenException(
        'La integración no tiene un plan activo. Contacte al administrador.',
      );
    }

    if (integration.subscriptionStatus !== SubscriptionStatus.ACTIVE) {
      throw new ForbiddenException(
        'La suscripción de esta integración está suspendida o cancelada. Contacte al administrador.',
      );
    }

    const includedTypes = this.resolveIncludedDocumentTypes(integration);

    if (!includedTypes.includes(documentType)) {
      throw new ForbiddenException(
        `La suscripción no incluye el tipo de documento ${documentType}.`,
      );
    }

    const documentLimit = this.limitFor(integration, documentType);

    if (requestedQuantity <= 0) {
      return { allowed: 0, documentLimit, documentsUsed: 0 };
    }

    if (documentLimit == null) {
      return { allowed: requestedQuantity, documentLimit: null, documentsUsed: 0 };
    }

    const startedAt = integration.subscriptionStartedAt ?? integration.createdAt;
    const documentsUsed = await this.countDocumentsSince(
      companyId,
      documentType,
      startedAt,
      provider,
    );
    const remaining = Math.max(0, documentLimit - documentsUsed);

    return {
      allowed: Math.min(requestedQuantity, remaining),
      documentLimit,
      documentsUsed,
    };
  }

  private buildLimitReachedMessage(
    documentLimit: number | null,
    documentsUsed: number,
    requestedQuantity: number,
  ): string {
    const remaining =
      documentLimit == null ? null : Math.max(0, documentLimit - documentsUsed);

    return (
      `Ha alcanzado el límite del plan (${documentLimit} documentos). ` +
      `Usados: ${documentsUsed}, disponibles: ${remaining}, solicitados: ${requestedQuantity}.`
    );
  }

  async assignPlan(params: {
    integration: Integration;
    planId: string;
    subscriptionStatus?: SubscriptionStatus;
    restartSubscription?: boolean;
    includedDocumentTypes?: ElectronicDocumentType[];
  }): Promise<Integration> {
    const plan = await this.plansRepository.findById(params.planId);

    if (!plan) {
      throw new NotFoundException('El plan seleccionado no existe o está inactivo.');
    }

    if (plan.provider !== params.integration.provider) {
      throw new BadRequestException(
        `El plan ${plan.code} no aplica para la integración ${params.integration.provider}.`,
      );
    }

    const shouldRestart =
      params.restartSubscription === true || !params.integration.planId;

    params.integration.plan = plan;
    params.integration.subscriptionStatus =
      params.subscriptionStatus ?? SubscriptionStatus.ACTIVE;

    if (params.includedDocumentTypes !== undefined) {
      params.integration.includedDocumentTypes = this.normalizeDocumentTypes(
        params.includedDocumentTypes,
      );
    } else if (
      this.normalizeDocumentTypes(params.integration.includedDocumentTypes)
        .length === 0
    ) {
      params.integration.includedDocumentTypes = this.normalizeDocumentTypes(
        plan.includedDocumentTypes,
      );
    }

    if (shouldRestart || !params.integration.subscriptionStartedAt) {
      params.integration.subscriptionStartedAt = new Date();
    }

    return this.integrationsRepository.save(params.integration);
  }

  async updateIncludedDocumentTypes(
    integration: Integration,
    documentTypes: ElectronicDocumentType[],
  ): Promise<Integration> {
    integration.includedDocumentTypes =
      this.normalizeDocumentTypes(documentTypes);
    return this.integrationsRepository.save(integration);
  }

  async updateSubscriptionStatus(
    integration: Integration,
    status: SubscriptionStatus,
  ): Promise<Integration> {
    integration.subscriptionStatus = status;
    return this.integrationsRepository.save(integration);
  }

  normalizeDocumentTypes(
    documentTypes?: ElectronicDocumentType[] | null,
  ): ElectronicDocumentType[] {
    const unique = [
      ...new Set(
        (documentTypes ?? []).filter((type) =>
          ALLOWED_DOCUMENT_TYPES.has(type),
        ),
      ),
    ];

    return unique;
  }

  private async buildSnapshot(
    integration: Integration,
  ): Promise<PlanSubscriptionSnapshot> {
    const plan = integration.plan;
    const includedDocumentTypes = this.resolveIncludedDocumentTypes(integration);

    if (!plan && !(integration.provider === IntegrationProvider.SIIGO && integration.documentLimits)) {
      return {
        ...this.emptySnapshot(),
        status: integration.subscriptionStatus,
        startedAt: integration.subscriptionStartedAt?.toISOString() ?? null,
        includedDocumentTypes,
      };
    }

    const startedAt = integration.subscriptionStartedAt ?? integration.createdAt;
    const usagePerType = await Promise.all(
      includedDocumentTypes.map((documentType) =>
        this.countDocumentsSince(integration.companyId, documentType, startedAt, integration.provider),
      ),
    );
    const documentQuotas = integration.provider === IntegrationProvider.SIIGO
      ? Object.fromEntries(includedDocumentTypes.map((type, index) => {
          const documentLimit = this.limitFor(integration, type);
          const documentsUsed = usagePerType[index];
          return [type, { documentLimit, documentsUsed, remaining: documentLimit === null ? null : Math.max(0, documentLimit - documentsUsed) }];
        })) : undefined;
    const documentsUsed = usagePerType.reduce((sum, count) => sum + count, 0);
    const quotaValues = documentQuotas ? Object.values(documentQuotas) : [];
    const documentLimit = documentQuotas
      ? (quotaValues.some(quota => quota.documentLimit === null) ? null : quotaValues.reduce((sum, quota) => sum + quota.documentLimit!, 0))
      : plan?.documentLimit ?? null;
    const remaining = documentQuotas
      ? (quotaValues.some(quota => quota.remaining === null) ? null : quotaValues.reduce((sum, quota) => sum + quota.remaining!, 0))
      : documentLimit === null ? null : Math.max(0, documentLimit - documentsUsed);

    return {
      status: integration.subscriptionStatus,
      startedAt: integration.subscriptionStartedAt?.toISOString() ?? null,
      documentLimit,
      documentsUsed,
      remaining,
      includedDocumentTypes,
      ...(documentQuotas ? { documentQuotas } : {}),
      plan: plan ? {
        id: plan.id,
        name: plan.name,
        code: plan.code,
        documentLimit: plan.documentLimit,
        includedDocumentTypes: plan.includedDocumentTypes ?? [],
      } : null,
    };
  }

  private async countDocumentsSince(
    companyId: string,
    documentType: ElectronicDocumentType,
    since: Date,
    provider: IntegrationProvider,
  ): Promise<number> {
    const query = this.electronicDocumentsRepository
      .createQueryBuilder('document')
      .where('document.companyId = :companyId', { companyId })
      .andWhere('document.electronicDocumentType = :documentType', {
        documentType,
      })
      .andWhere('document.status = :status', {
        status: ElectronicDocumentStatus.PURCHASE_CREATED,
      })
      .andWhere('document.createdAt >= :since', { since });
    if (provider === IntegrationProvider.SIIGO) query.andWhere('document.alreadyInSiigo = :alreadyInSiigo', { alreadyInSiigo: false });
    return query.getCount();
  }

  private emptySnapshot(): PlanSubscriptionSnapshot {
    return {
      status: null,
      startedAt: null,
      documentLimit: null,
      documentsUsed: 0,
      remaining: null,
      includedDocumentTypes: [],
      plan: null,
    };
  }
}
