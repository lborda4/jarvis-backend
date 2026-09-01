import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserCompany } from '../auth/entities/user-company.entity';
import { Company } from '../company/entities/company.entity';
import { CompanyPersonType } from '../company/enums/company-person-type.enum';
import { CompaniesRepository } from '../company/repositories/companies.repository';
import { Integration } from '../integration/entities/integration.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import {
  ensureJarvisIntegration,
  ensureSiigoIntegration,
} from '../integration/helpers/integration-setup.helper';
import { buildJarvisCredentialsSeed } from '../integration/jarvis/helpers/jarvis-credentials.helper';
import { JarvisDocumentType } from '../integration/jarvis/enums/jarvis-document-type.enum';
import { NextPymeMasterCatalogService } from '../integration/jarvis/nextpyme/nextpyme-master-catalog.service';
import { NextPymeRutService } from '../integration/jarvis/nextpyme-rut.service';
import { IntegrationsRepository } from '../integration/repositories/integrations.repository';
import { Plan } from '../plan/entities/plan.entity';
import { SubscriptionStatus } from '../plan/enums/subscription-status.enum';
import { PlanSubscriptionService } from '../plan/plan-subscription.service';
import { PlansRepository } from '../plan/repositories/plans.repository';
import type { CompanyResponsible } from '../company/interfaces/company-responsible.interface';
import { generateCompanyInviteCode } from '../company/helpers/company-invite-code.helper';
import {
  AdminCompanyListItemDto,
  AdminIntegrationItemDto,
  AdminPlanDto,
  CreateAdminCompanyRequestDto,
  CreateAdminCompanyResponseDto,
  JarvisCredentialsSeedDto,
  ListAdminCitiesResponseDto,
  ListAdminCompaniesResponseDto,
  ListAdminPlansResponseDto,
  LookupAdminCompanyNameResponseDto,
  RegenerateCompanyInviteCodeResponseDto,
  UpdateCompanyCityRequestDto,
  UpdateCompanyCityResponseDto,
  UpdateCompanyNextPymeTokenRequestDto,
  UpdateCompanyNextPymeTokenResponseDto,
  UpdateIntegrationSubscriptionRequestDto,
  UpdateIntegrationSubscriptionResponseDto,
} from './dto/admin-company.dto';

const ALLOWED_INTEGRATIONS = new Set<IntegrationProvider>([
  IntegrationProvider.SIIGO,
  IntegrationProvider.JARVIS,
]);

@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly companiesRepository: CompaniesRepository,
    private readonly plansRepository: PlansRepository,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly planSubscriptionService: PlanSubscriptionService,
    private readonly nextPymeMasterCatalogService: NextPymeMasterCatalogService,
    private readonly nextPymeRutService: NextPymeRutService,
  ) {}

  /**
   * Busca la razón social en el RUT/RUES de la DIAN a partir del NIT — para
   * precargar el campo "Nombre" al crear la empresa sin tener que subir el
   * PDF del RUT. Usa el token global de NextPyme (todavía no existe empresa
   * ni token propio en este punto). Nunca lanza: si falla o no encuentra
   * nada, devuelve name: null y el admin lo llena a mano, igual que hoy.
   */
  async lookupCompanyName(
    nit: string,
  ): Promise<LookupAdminCompanyNameResponseDto> {
    const normalizedNit = nit.replace(/[^\d]/g, '');

    if (!normalizedNit) {
      return { name: null };
    }

    try {
      const result = await this.nextPymeRutService.lookupDocument(
        JarvisDocumentType.NIT,
        normalizedNit,
      );

      return { name: result.found ? (result.name?.trim() ?? null) : null };
    } catch {
      return { name: null };
    }
  }

  async listCities(): Promise<ListAdminCitiesResponseDto> {
    const municipalities =
      await this.nextPymeMasterCatalogService.getMunicipalities();

    return {
      items: municipalities
        .filter((row) => row.code)
        .map((row) => ({
          code: String(row.code),
          name: row.name,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  async listPlans(): Promise<ListAdminPlansResponseDto> {
    const plans = await this.plansRepository.findAllActive();

    return {
      items: plans.map((plan) => this.mapPlan(plan)),
    };
  }

  async listCompanies(
    _adminUserId: string,
  ): Promise<ListAdminCompaniesResponseDto> {
    const companies = await this.companiesRepository.findAllWithIntegrations();

    return {
      items: companies.map((company) => this.mapCompany(company)),
    };
  }

  async createCompany(
    request: CreateAdminCompanyRequestDto,
    adminUserId: string,
  ): Promise<CreateAdminCompanyResponseDto> {
    const nit = this.normalizeNit(request?.nit);
    const name = request?.name?.trim();
    const personType = this.normalizePersonType(request?.personType);
    const responsible = this.normalizeResponsible(request?.responsible);
    const integrations = this.normalizeIntegrations(request?.integrations);
    const siigoPlanId = request?.siigoPlanId?.trim();
    const jarvisPlanId = request?.jarvisPlanId?.trim();

    if (!nit) {
      throw new BadRequestException('El NIT es obligatorio.');
    }

    if (!name) {
      throw new BadRequestException('El nombre de la empresa es obligatorio.');
    }

    if (!personType) {
      throw new BadRequestException(
        'Debe indicar si la empresa es persona natural o persona jurídica.',
      );
    }

    if (integrations.length === 0) {
      throw new BadRequestException(
        'Debe seleccionar al menos una integración (SIIGO, Jarvis o ambas).',
      );
    }

    const includesSiigo = integrations.includes(IntegrationProvider.SIIGO);
    const includesJarvis = integrations.includes(IntegrationProvider.JARVIS);
    const requestedDocumentTypes =
      this.planSubscriptionService.normalizeDocumentTypes(
        request?.includedDocumentTypes,
      );

    if (
      (includesSiigo || includesJarvis) &&
      requestedDocumentTypes.length === 0
    ) {
      throw new BadRequestException(
        'Debe seleccionar al menos un tipo de documento (Documento soporte o Factura de compra).',
      );
    }

    const siigoPlan = includesSiigo
      ? await this.requirePlanForProvider(
          siigoPlanId,
          IntegrationProvider.SIIGO,
          'SIIGO',
        )
      : null;
    const jarvisPlan = includesJarvis
      ? await this.requirePlanForProvider(
          jarvisPlanId,
          IntegrationProvider.JARVIS,
          'Jarvis',
        )
      : null;

    const existingCompany = await this.companiesRepository.findByNit(nit);

    if (existingCompany) {
      throw new ConflictException(`Ya existe una empresa con el NIT ${nit}.`);
    }

    const company = await this.dataSource.transaction(async (manager) => {
      const companiesRepository = manager.getRepository(Company);
      const userCompaniesRepository = manager.getRepository(UserCompany);
      const integrationsRepository = manager.getRepository(Integration);

      const createdCompany = await companiesRepository.save(
        companiesRepository.create({
          nit,
          name,
          personType,
          responsible,
          inviteCode: generateCompanyInviteCode(),
          cityCode: request?.cityCode?.trim() || null,
          cityName: request?.cityName?.trim() || null,
          nextPymeToken: request?.nextPymeToken?.trim() || null,
        }),
      );

      for (const provider of integrations) {
        if (provider === IntegrationProvider.SIIGO) {
          const integration = await ensureSiigoIntegration(
            manager,
            createdCompany.id,
          );

          if (siigoPlan) {
            integration.plan = siigoPlan;
            integration.includedDocumentTypes = requestedDocumentTypes;
            integration.subscriptionStatus = SubscriptionStatus.ACTIVE;
            integration.subscriptionStartedAt = new Date();
            await integrationsRepository.save(integration);
          }
        }

        if (provider === IntegrationProvider.JARVIS) {
          const jarvisCredentials = this.normalizeJarvisCredentialsSeed(
            request?.jarvisCredentials,
          );

          const integration = await ensureJarvisIntegration(
            manager,
            createdCompany.id,
            jarvisCredentials ?? {},
          );

          if (jarvisPlan) {
            integration.plan = jarvisPlan;
            integration.includedDocumentTypes = requestedDocumentTypes;
            integration.subscriptionStatus = SubscriptionStatus.ACTIVE;
            integration.subscriptionStartedAt = new Date();
            await integrationsRepository.save(integration);
          }
        }
      }

      const existingLink = await userCompaniesRepository.findOne({
        where: {
          userId: adminUserId,
          companyId: createdCompany.id,
        },
      });

      if (!existingLink) {
        await userCompaniesRepository.save(
          userCompaniesRepository.create({
            userId: adminUserId,
            companyId: createdCompany.id,
          }),
        );
      }

      return companiesRepository.findOne({
        where: { id: createdCompany.id },
        relations: { integrations: { plan: true } },
      });
    });

    if (!company) {
      throw new BadRequestException('No se pudo crear la empresa.');
    }

    return {
      company: this.mapCompany(company),
    };
  }

  async regenerateInviteCode(
    companyId: string,
    _adminUserId: string,
  ): Promise<RegenerateCompanyInviteCodeResponseDto> {
    const company = await this.companiesRepository.findById(companyId);

    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    company.inviteCode = generateCompanyInviteCode();
    const saved = await this.companiesRepository.save(company);

    return {
      company: this.mapCompany(saved),
    };
  }

  async updateNextPymeToken(
    companyId: string,
    request: UpdateCompanyNextPymeTokenRequestDto,
    _adminUserId: string,
  ): Promise<UpdateCompanyNextPymeTokenResponseDto> {
    const company = await this.companiesRepository.findById(companyId);

    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    company.nextPymeToken = request.nextPymeToken?.trim() || null;
    const saved = await this.companiesRepository.save(company);

    return {
      company: this.mapCompany(saved),
    };
  }

  async updateCompanyCity(
    companyId: string,
    request: UpdateCompanyCityRequestDto,
    _adminUserId: string,
  ): Promise<UpdateCompanyCityResponseDto> {
    const company = await this.companiesRepository.findById(companyId);

    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    company.cityCode = request.cityCode?.trim() || null;
    company.cityName = request.cityName?.trim() || null;
    const saved = await this.companiesRepository.save(company);

    return {
      company: this.mapCompany(saved),
    };
  }

  private async requirePlanForProvider(
    planId: string | undefined,
    provider: IntegrationProvider,
    label: string,
  ): Promise<Plan> {
    if (!planId) {
      throw new BadRequestException(
        `Debe seleccionar un plan ${label} para la empresa.`,
      );
    }

    const plan = await this.plansRepository.findById(planId);

    if (!plan) {
      throw new NotFoundException(
        `El plan ${label} seleccionado no existe o está inactivo.`,
      );
    }

    if (plan.provider !== provider) {
      throw new BadRequestException(
        `El plan seleccionado no corresponde a la integración ${label}.`,
      );
    }

    return plan;
  }

  async updateIntegrationSubscription(
    companyId: string,
    provider: IntegrationProvider,
    request: UpdateIntegrationSubscriptionRequestDto,
    _adminUserId: string,
  ): Promise<UpdateIntegrationSubscriptionResponseDto> {
    const company = await this.companiesRepository.findById(companyId);

    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    const integration =
      await this.integrationsRepository.findByCompanyAndProviderWithPlan(
        companyId,
        provider,
      );

    if (!integration) {
      throw new NotFoundException(
        `La integración ${provider} no existe para esta empresa.`,
      );
    }

    const planId = request.planId?.trim();
    const hasStatus = request.subscriptionStatus != null;
    const hasDocumentTypes = request.includedDocumentTypes !== undefined;

    if (!planId && !hasStatus && !hasDocumentTypes) {
      throw new BadRequestException(
        'Debe indicar un plan, tipos de documento y/o un estado de suscripción.',
      );
    }

    if (hasDocumentTypes) {
      const documentTypes = this.planSubscriptionService.normalizeDocumentTypes(
        request.includedDocumentTypes,
      );

      if (documentTypes.length === 0) {
        throw new BadRequestException(
          'Debe seleccionar al menos un tipo de documento.',
        );
      }

      await this.planSubscriptionService.updateIncludedDocumentTypes(
        integration,
        documentTypes,
      );
    }

    if (planId) {
      await this.planSubscriptionService.assignPlan({
        integration,
        planId,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        restartSubscription: request.restartSubscription,
        includedDocumentTypes: hasDocumentTypes
          ? request.includedDocumentTypes
          : undefined,
      });
    } else if (hasStatus) {
      await this.planSubscriptionService.updateSubscriptionStatus(
        integration,
        request.subscriptionStatus!,
      );
    }

    const updated =
      await this.integrationsRepository.findByCompanyAndProviderWithPlan(
        companyId,
        provider,
      );

    if (!updated) {
      throw new BadRequestException('No se pudo actualizar la suscripción.');
    }

    return {
      integration: this.mapIntegration(updated),
    };
  }

  private mapPlan(plan: Plan): AdminPlanDto {
    return {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      provider: plan.provider,
      documentLimit: plan.documentLimit,
      includedDocumentTypes: plan.includedDocumentTypes ?? [],
    };
  }

  private mapIntegration(integration: Integration): AdminIntegrationItemDto {
    return {
      id: integration.id,
      provider: integration.provider,
      active: integration.active,
      subscriptionStatus: integration.subscriptionStatus,
      subscriptionStartedAt:
        integration.subscriptionStartedAt?.toISOString() ?? null,
      includedDocumentTypes:
        this.planSubscriptionService.resolveIncludedDocumentTypes(integration),
      plan: integration.plan ? this.mapPlan(integration.plan) : null,
    };
  }

  private mapCompany(company: Company): AdminCompanyListItemDto {
    return {
      id: company.id,
      nit: company.nit,
      name: company.name,
      personType: company.personType,
      responsible: company.responsible,
      createdAt: company.createdAt.toISOString(),
      inviteCode: company.inviteCode,
      nextPymeToken: company.nextPymeToken,
      cityCode: company.cityCode,
      cityName: company.cityName,
      integrations: (company.integrations ?? [])
        .filter((integration) => integration.active)
        .map((integration) => this.mapIntegration(integration))
        .sort((left, right) => left.provider.localeCompare(right.provider)),
    };
  }

  private normalizeIntegrations(
    integrations?: IntegrationProvider[],
  ): IntegrationProvider[] {
    const unique = [
      ...new Set(
        (integrations ?? [])
          .map((provider) => String(provider).trim().toUpperCase())
          .filter(Boolean),
      ),
    ];

    const normalized: IntegrationProvider[] = [];

    for (const provider of unique) {
      if (provider === IntegrationProvider.SIIGO) {
        normalized.push(IntegrationProvider.SIIGO);
      }

      if (provider === IntegrationProvider.JARVIS) {
        normalized.push(IntegrationProvider.JARVIS);
      }
    }

    return normalized.filter((provider) => ALLOWED_INTEGRATIONS.has(provider));
  }

  private normalizePersonType(
    personType?: CompanyPersonType,
  ): CompanyPersonType | null {
    return Object.values(CompanyPersonType).includes(personType!)
      ? personType!
      : null;
  }

  private normalizeResponsible(
    responsible?: Partial<CompanyResponsible>,
  ): CompanyResponsible | null {
    const name = responsible?.name?.trim() ?? '';
    const phone = responsible?.phone?.trim() ?? '';
    const email = responsible?.email?.trim().toLowerCase() ?? '';

    if (!name && !phone && !email) {
      return null;
    }

    return { name, phone, email };
  }

  private normalizeJarvisCredentialsSeed(
    seed?: JarvisCredentialsSeedDto,
  ): ReturnType<typeof buildJarvisCredentialsSeed> | null {
    if (!seed || typeof seed !== 'object') {
      return null;
    }

    const credentials = buildJarvisCredentialsSeed(seed);

    if (
      !credentials.business_name &&
      !credentials.address &&
      !credentials.email &&
      !credentials.phone &&
      !credentials.department &&
      !credentials.municipality &&
      !credentials.economic_activity &&
      !credentials.tax_regime &&
      !credentials.vat_regime &&
      !credentials.id_software &&
      !credentials.token_nextpyme
    ) {
      return null;
    }

    return credentials;
  }

  private normalizeNit(nit?: string): string {
    return nit?.replace(/[^\d]/g, '') ?? '';
  }
}
