import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Integration } from '../entities/integration.entity';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { JarvisDianResolution, IntegrationCredentials } from '../interfaces/integration-credentials.interface';
import { SubscriptionStatus } from '../../plan/enums/subscription-status.enum';

@Injectable()
export class IntegrationsRepository {
  constructor(
    @InjectRepository(Integration)
    private readonly repository: Repository<Integration>,
  ) {}

  findByCompanyAndProvider(
    companyId: string,
    provider: IntegrationProvider,
  ): Promise<Integration | null> {
    return this.repository.findOne({
      where: { companyId, provider, active: true },
    });
  }

  findByCompanyAndProviderWithPlan(
    companyId: string,
    provider: IntegrationProvider,
  ): Promise<Integration | null> {
    return this.repository.findOne({
      where: { companyId, provider, active: true },
      relations: { plan: true },
    });
  }

  findByIdWithPlan(id: string): Promise<Integration | null> {
    return this.repository.findOne({
      where: { id },
      relations: { plan: true },
    });
  }

  create(
    data: Pick<
      Integration,
      'companyId' | 'provider' | 'credentials' | 'active'
    > &
      Partial<
        Pick<Integration, 'plan' | 'subscriptionStartedAt' | 'subscriptionStatus'>
      >,
  ): Integration {
    return this.repository.create(data);
  }

  findAllActiveByProvider(
    provider: IntegrationProvider,
  ): Promise<Integration[]> {
    return this.repository.find({
      where: { provider, active: true },
    });
  }

  /** Todas las integraciones activas de un proveedor con suscripción
   * ACTIVA — usado por el resync automático de historial de compras en
   * segundo plano, que no tiene sentido gastar contra SIIGO en empresas
   * suspendidas/canceladas o con la integración apagada. */
  findAllActiveByProviderAndSubscription(
    provider: IntegrationProvider,
    subscriptionStatus: SubscriptionStatus,
  ): Promise<Integration[]> {
    return this.repository.find({
      where: { provider, active: true, subscriptionStatus },
    });
  }

  findAllByCompanyId(companyId: string): Promise<Integration[]> {
    return this.repository.find({
      where: { companyId, active: true },
      relations: { plan: true },
      order: { provider: 'ASC' },
    });
  }

  /** Actualización atómica de una sola resolución. GREATEST impide retrocesos por respuestas tardías. */
  async advanceJarvisResolutionNumber(companyId: string, key: string, resolution: JarvisDianResolution): Promise<void> {
    const rows = await this.repository.query(
      `WITH advanced AS (UPDATE integrations SET credentials = jsonb_set(COALESCE(credentials,'{}'::jsonb), '{resolutions}',
        (CASE WHEN jsonb_typeof(credentials->'resolutions')='object' THEN credentials->'resolutions' ELSE '{}'::jsonb END) ||
        jsonb_build_object($3::text,
          $4::jsonb ||
          (CASE WHEN jsonb_typeof(credentials #> ARRAY['resolutions',$3::text])='object' THEN credentials #> ARRAY['resolutions',$3::text] ELSE '{}'::jsonb END) ||
          jsonb_build_object('nextConsecutive',GREATEST(
            CASE WHEN credentials #>> ARRAY['resolutions',$3::text,'nextConsecutive'] ~ '^[0-9]+$'
              THEN (credentials #>> ARRAY['resolutions',$3::text,'nextConsecutive'])::numeric ELSE 0 END,
            ($4::jsonb->>'nextConsecutive')::numeric
          ))
        ), true), updated_at=NOW()
       WHERE company_id=$1 AND provider=$2 AND active=true
         AND COALESCE(NULLIF(BTRIM(credentials #>> ARRAY['resolutions',$3::text,'prefix']),''),$5)=$5
       RETURNING id) SELECT id FROM advanced`,
      [companyId, IntegrationProvider.JARVIS, key, JSON.stringify(resolution), resolution.prefix.trim()],
    );
    if (!rows.length) throw new ConflictException('La configuración del prefijo cambió durante el envío. Revisa la resolución e intenta nuevamente.');
  }

  save(integration: Integration): Promise<Integration> {
    return this.repository.save(integration);
  }

  async updateCredentials(
    integration: Integration,
    credentials: IntegrationCredentials,
  ): Promise<Integration> {
    integration.credentials = credentials;
    return this.repository.save(integration);
  }
}
