import { withBillingOperation } from '../integration/jarvis/helpers/jarvis-billing-operation';
import { commercialActivity } from './commercial-activity';
import { advisorSaleItems, recordAdvisorSale, planSaleTerms } from '../advisor/advisor-commission';
import { Advisor } from '../auth/entities/advisor.entity';
import { applyJarvisTopUp, type ApplyJarvisTopUpRequest } from './apply-jarvis-top-up';
import { jarvisSubscriptionPeriod } from '../plan/jarvis-subscription';
import { assignJarvisCertificateTerm, type JarvisCertificateTerm } from '../plan/jarvis-certificate-term';
import { UpdateAdminPlanRequestDto } from './dto/admin-plan.dto';
import { billingMonthsFromCycle, companyTrackingDueDate, normalizeCompanyTracking, trackingToday } from './company-tracking';
import { UpdateCompanySoftwareRequestDto } from './dto/admin-company.dto';
import { UpdateCompanyTrackingDto } from './dto/admin-company.dto';
import type { BoldCredentials } from '../integration/interfaces/integration-credentials.interface';
import { SaveAdminBoldCredentialsDto, AdminBoldCredentialsStatusDto } from './dto/admin-bold-credentials.dto';
import { readCompanyAiContext, validateCompanyAiContext } from '../company/company-ai-context';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserCompany } from '../auth/entities/user-company.entity';
import { UserRole } from '../auth/enums/user-role.enum';
import { Company } from '../company/entities/company.entity';
import { registrationEmail } from '../auth/helpers/company-registration.helper';
import { DEFAULT_JARVIS_MODULES, validateJarvisModules } from '../company/jarvis-modules';
import { CompanyPersonType } from '../company/enums/company-person-type.enum';
import { CompaniesRepository } from '../company/repositories/companies.repository';
import { Integration } from '../integration/entities/integration.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import {
  ensureBoldIntegration,
  ensureJarvisIntegration,
  ensureSiigoIntegration,
} from '../integration/helpers/integration-setup.helper';
import { buildJarvisCredentialsSeed } from '../integration/jarvis/helpers/jarvis-credentials.helper';
import { JarvisDocumentType } from '../integration/jarvis/enums/jarvis-document-type.enum';
import { NextPymeMasterCatalogService } from '../integration/jarvis/nextpyme/nextpyme-master-catalog.service';
import { NextPymeRutService } from '../integration/jarvis/nextpyme-rut.service';
import { NextPymeApiClient } from '../integration/jarvis/nextpyme/nextpyme-api.client';
import { IntegrationsRepository } from '../integration/repositories/integrations.repository';
import { Plan } from '../plan/entities/plan.entity';
import { SubscriptionStatus } from '../plan/enums/subscription-status.enum';
import { PlanSubscriptionService } from '../plan/plan-subscription.service';
import { PlansRepository } from '../plan/repositories/plans.repository';
import { listJarvisTopUps, resolveJarvisTopUps } from '../plan/jarvis-top-ups';
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
  UpdateCompanyDescriptionRequestDto,
  UpdateCompanyDescriptionResponseDto,
  UpdateCompanyNextPymeTokenRequestDto,
  UpdateCompanyNextPymeTokenResponseDto,
  UpdateCompanyTechnicalKeyRequestDto,
  UpdateCompanyTechnicalKeyResponseDto,
  UpdateIntegrationSubscriptionRequestDto,
  UpdateIntegrationSubscriptionResponseDto,
  UpdateSiigoDocumentQuotasRequestDto,
  UpdateSiigoDocumentQuotasResponseDto,
} from './dto/admin-company.dto';

const ALLOWED_INTEGRATIONS = new Set<IntegrationProvider>([
  IntegrationProvider.SIIGO,
  IntegrationProvider.JARVIS,
  IntegrationProvider.BOLD,
]);

@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly companiesRepository: CompaniesRepository,
    private readonly plansRepository: PlansRepository,
    private readonly integrationsRepository: IntegrationsRepository,
    @Inject(forwardRef(() => PlanSubscriptionService))
    private readonly planSubscriptionService: PlanSubscriptionService,
    private readonly nextPymeMasterCatalogService: NextPymeMasterCatalogService,
    private readonly nextPymeRutService: NextPymeRutService,
    private readonly nextPymeApiClient: NextPymeApiClient,
  ) {}

  /**
   * Busca la razón social en el RUT/RUES de la DIAN a partir del NIT — para
   * precargar el campo "Nombre" al crear la empresa sin tener que subir el
   * PDF del RUT. Usa el token global de NextPyme (todavía no existe empresa
   * ni token propio en este punto). Nunca lanza: si falla o no encuentra
   * nada, devuelve name: null y el admin lo llena a mano, igual que hoy.
   */
  async getBoldCredentials(companyId: string): Promise<AdminBoldCredentialsStatusDto> {
    const integration = await this.requireBoldIntegration(companyId);
    const credentials = integration.credentials as BoldCredentials;
    return {
      identityKey: credentials.identity_key ?? '',
      hasSecretKey: Boolean(credentials.secret_key),
    };
  }

  async saveBoldCredentials(companyId: string, request: SaveAdminBoldCredentialsDto): Promise<AdminBoldCredentialsStatusDto> {
    if (typeof request?.identityKey !== 'string' || !request.identityKey.trim() || request.identityKey.trim().length > 4096) {
      throw new BadRequestException('Ingrese una llave de identidad válida.');
    }
    if (request.secretKey !== undefined && (typeof request.secretKey !== 'string' || request.secretKey.trim().length > 4096)) {
      throw new BadRequestException('Ingrese una llave secreta válida.');
    }
    const integration = await this.requireBoldIntegration(companyId);
    const current = integration.credentials as BoldCredentials;
    const secretKey = request.secretKey?.trim() || current.secret_key;
    if (!secretKey) throw new BadRequestException('Ingrese la llave secreta para configurar Bold.');
    integration.credentials = {
      ...integration.credentials,
      identity_key: request.identityKey.trim(),
      secret_key: secretKey,
    };
    await this.integrationsRepository.save(integration);
    return { identityKey: request.identityKey.trim(), hasSecretKey: true };
  }

  private async requireBoldIntegration(companyId: string): Promise<Integration> {
    const integration = await this.integrationsRepository.findByCompanyAndProvider(companyId, IntegrationProvider.BOLD);
    if (!integration) throw new NotFoundException('La empresa no tiene una integración Bold activa.');
    return integration;
  }

  async lookupCompanyName(
    nit: string,
    companyId?: string,
  ): Promise<LookupAdminCompanyNameResponseDto> {
    const normalizedNit = nit.replace(/[^\d]/g, '');

    if (!normalizedNit) {
      return { name: null };
    }

    try {
      const result = await this.nextPymeRutService.lookupDocument(
        JarvisDocumentType.NIT,
        normalizedNit,
        await this.nextPymeMasterCatalogService.requireCompanyToken(companyId),
      );

      return { name: result.found ? (result.name?.trim() ?? null) : null };
    } catch {
      return { name: null };
    }
  }

  async listCities(companyId?: string): Promise<ListAdminCitiesResponseDto> {
    const municipalities =
      await this.nextPymeMasterCatalogService.getMunicipalities(companyId);

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

  async addCompanyIntegration(companyId: string, provider: IntegrationProvider) {
    if (!ALLOWED_INTEGRATIONS.has(provider)) {
      throw new BadRequestException('Seleccione Siigo, Jarvis o Bold.');
    }
    await this.dataSource.transaction(async manager => {
      const company = await manager.getRepository(Company).findOne({
        where: { id: companyId }, lock: { mode: 'pessimistic_write' },
      });
      if (!company) throw new NotFoundException('Empresa no encontrada.');
      const repository = manager.getRepository(Integration);
      const existing = await repository.findOne({ where: { companyId, provider } });
      if (existing) {
        if (!existing.active) {
          existing.active = true;
          await repository.save(existing);
        }
        return;
      }
      if (provider === IntegrationProvider.SIIGO) {
        await ensureSiigoIntegration(manager, companyId);
      } else if (provider === IntegrationProvider.JARVIS) {
        await ensureJarvisIntegration(manager, companyId);
      } else {
        await ensureBoldIntegration(manager, companyId);
      }
    });
    const company = (await this.companiesRepository.findAllWithIntegrations()).find(item => item.id === companyId);
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    return { company: this.mapCompany(company) };
  }
  async selectCompanyIntegration(companyId: string, provider: IntegrationProvider) {
    if (![IntegrationProvider.SIIGO, IntegrationProvider.JARVIS].includes(provider)) {
      throw new BadRequestException('Seleccione SIIGO o Jarvis.');
    }
    await this.dataSource.transaction(async manager => {
      const company = await manager.getRepository(Company).findOne({
        where: { id: companyId }, lock: { mode: 'pessimistic_write' },
      });
      if (!company) throw new NotFoundException('Empresa no encontrada.');
      const repository = manager.getRepository(Integration);
      let selected = await repository.findOne({ where: { companyId, provider } });
      if (!selected) {
        selected = provider === IntegrationProvider.JARVIS
          ? await ensureJarvisIntegration(manager, companyId)
          : await ensureSiigoIntegration(manager, companyId);
      }
      await repository.update({ companyId, provider: provider === IntegrationProvider.JARVIS ? IntegrationProvider.SIIGO : IntegrationProvider.JARVIS }, { active: false });
      selected.active = true;
      await repository.save(selected);
    });
    const company = (await this.companiesRepository.findAllWithIntegrations()).find(item => item.id === companyId);
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    return { company: this.mapCompany(company) };
  }

  async getNextPymePackage(companyId: string) {
    const company = await this.companiesRepository.findById(companyId);
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    const token = company.nextPymeToken?.trim();
    if (!token) throw new BadRequestException('La empresa no tiene un token de NextPyme configurado.');
    return { data: await this.nextPymeApiClient.getAssignedPackage(token) };
  }

  async assignNextPymePackage(companyId: string, request: { documents: number }) {
    if (!Number.isSafeInteger(request.documents) || request.documents < 1) throw new BadRequestException('Indica una cantidad entera de documentos mayor que cero.');
    const company = await this.companiesRepository.findById(companyId);
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    return this.assignNextPymePackageForNit(company.nit, request.documents);
  }

  async applyCompanyJarvisTopUp(companyId: string, request: ApplyJarvisTopUpRequest) {
    const operation = await applyJarvisTopUp(this.dataSource, companyId, request,
      documents => this.assignNextPymePackage(companyId, { documents }));
    return { ...await this.companyCommercialState(companyId), operation };
  }

  private async assignJarvisPlanPackage(companyId: string) {
    const integration = await this.integrationsRepository.findByCompanyAndProviderWithPlan(companyId, IntegrationProvider.JARVIS);
    if (!integration?.jarvisDocumentCycle || !integration.pendingInitialDocuments) return;
    const company = integration.company ?? await this.companiesRepository.findById(companyId);
    const period = jarvisSubscriptionPeriod(integration);
    if (!company?.nextPymeToken?.trim() || period.expired || period.notStarted) return;
    const cycleId = integration.jarvisDocumentCycle.id;
    await applyJarvisTopUp(this.dataSource, companyId, { operationId: `plan-${cycleId}`, topUpCodes: [] },
      documents => this.assignNextPymePackage(companyId, { documents }), cycleId);
  }

  private async assignNextPymePackageForNit(companyNit: string, documents: number) {
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now())).replace(',', '');
    const jarvisCompany = await this.companiesRepository.findByNit('902086460');
    const jarvisToken = jarvisCompany?.nextPymeToken?.trim();
    if (!jarvisToken) throw new BadRequestException('Configura el token NextPyme de JARVIS COLOMBIA S.A.S. para recargar documentos.');
    const nit = String(companyNit ?? '').split('-')[0].replace(/\D/g, '');
    const identification = Number(nit);
    if (!nit || !Number.isSafeInteger(identification) || identification <= 0) throw new BadRequestException('El NIT de la empresa no es válido.');
    return { data: await this.nextPymeApiClient.assignDocumentPackage({
      user_identification_number: identification,
      absolut_start_plan_date: date,
      absolut_documents: documents,
    }, jarvisToken) };
  }

  private async readJarvisCertificateTerm(nit: string, companyToken?: string | null): Promise<JarvisCertificateTerm> {
    const token = companyToken?.trim() || (await this.companiesRepository.findByNit('902086460'))?.nextPymeToken?.trim();
    if (!token) throw new BadRequestException('Configura el token de NextPyme para consultar el certificado digital antes de asignar el plan Jarvis.');
    return this.nextPymeApiClient.getCertificateTerm(nit, token);
  }

  async updatePlan(planId: string, request: UpdateAdminPlanRequestDto): Promise<{ plan: AdminPlanDto }> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId)) {
      throw new BadRequestException('Identificador de plan invalido.');
    }
    if (typeof request?.name !== 'string' || !request.name.trim() || request.name.trim().length > 255) {
      throw new BadRequestException('Ingrese un nombre de plan de hasta 255 caracteres.');
    }
    const limit = request.documentLimit;
    if (limit !== null && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 2147483647)) {
      throw new BadRequestException('El cupo debe ser un entero positivo o null para un plan sin limite.');
    }
    const plan = await this.plansRepository.findById(planId);
    if (!plan) throw new NotFoundException('Plan no encontrado.');
    if (plan.provider !== IntegrationProvider.SIIGO && plan.provider !== IntegrationProvider.JARVIS) {
      throw new BadRequestException('Solo se pueden editar planes de Siigo y Jarvis.');
    }
    // El proveedor y el codigo se conservan para no mover suscripciones entre integraciones.
    plan.name = request.name.trim();
    plan.documentLimit = limit;
    if (request.commissionClass !== undefined) {
      if (request.commissionClass !== null && !['BASIC', 'PLUS', 'PRO'].includes(request.commissionClass)) throw new BadRequestException('Selecciona clase básica, plus o pro.');
      plan.commissionClass = request.commissionClass;
    }
    if (request.salePriceCop !== undefined) {
      if (request.salePriceCop !== null && (typeof request.salePriceCop !== 'number' || !Number.isFinite(request.salePriceCop) || request.salePriceCop < 0 || request.salePriceCop > 999999999999.99 || Math.abs(Math.round(request.salePriceCop * 100) / 100 - request.salePriceCop) > 0.0000001)) throw new BadRequestException('Indica un precio válido en COP.');
      if (plan.commercialTerms && request.salePriceCop !== plan.commercialTerms.priceCop) throw new BadRequestException('El precio de este producto está definido en el portafolio Jarvis.');
      plan.salePriceCop = request.salePriceCop?.toFixed(2) ?? null;
    }
    const saved = await this.dataSource.getRepository(Plan).save(plan);
    return { plan: this.mapPlan(saved) };
  }
  async listPlans(): Promise<ListAdminPlansResponseDto> {
    const plans = await this.plansRepository.findAllActive();

    return {
      items: plans.map((plan) => this.mapPlan(plan)),
    };
  }

  listJarvisTopUps() {
    return { items: listJarvisTopUps() };
  }

  async updateCompanyTracking(companyId: string, request: UpdateCompanyTrackingDto, paidBy?: string) {
    let tracking = normalizeCompanyTracking(request?.commercial, request?.billingCycle, request?.billingMonths);
    if (request.paymentReceived !== undefined && typeof request.paymentReceived !== 'boolean') throw new BadRequestException('Indica si se recibió el pago.');
    let jarvisRenewal: { integration: Integration; term: JarvisCertificateTerm } | null = null;
    if (request.paymentReceived) {
      const before = await this.companiesRepository.findById(companyId);
      if (!before) throw new NotFoundException('Empresa no encontrada.');
      if (request.expectedDueDate === undefined || request.expectedDueDate !== companyTrackingDueDate(before))
        throw new ConflictException('El vencimiento cambió. Actualiza el seguimiento antes de registrar otro pago.');
      const integration = await this.integrationsRepository.findByCompanyAndProviderWithPlan(companyId, IntegrationProvider.JARVIS);
      if (integration?.plan) {
        if (request.expectedJarvisCycleId !== undefined && request.expectedJarvisCycleId !== (integration.jarvisDocumentCycle?.id ?? null))
          throw new ConflictException('El plan cambió. Actualiza el seguimiento antes de registrar el pago.');
        const term = await this.readJarvisCertificateTerm(before.nit, before.nextPymeToken);
        if (new Date() < new Date(term.startsAt) || new Date() >= new Date(term.endsAt))
          throw new BadRequestException('Renueva el certificado digital para habilitar el nuevo período del plan Jarvis.');
        jarvisRenewal = { integration, term };
        if (integration.plan.commercialTerms) tracking = normalizeCompanyTracking(request?.commercial, 'ANNUAL', integration.plan.commercialTerms.billingMonths);
      }
    }
    const company = await this.dataSource.transaction(async manager => {
      const repository = manager.getRepository(Company);
      const company = await repository.findOne({ where: { id: companyId }, lock: { mode: 'pessimistic_write' } });
      if (!company) throw new NotFoundException('Empresa no encontrada.');
      if (request.paymentReceived) {
        const currentDueDate = companyTrackingDueDate(company);
        if (request.expectedDueDate === undefined || request.expectedDueDate !== currentDueDate) throw new ConflictException('El vencimiento cambió. Actualiza el seguimiento antes de registrar otro pago.');
        const now = new Date();
        const today = trackingToday(now);
        company.trackingPeriodStart = currentDueDate && currentDueDate > today ? currentDueDate : today;
        company.trackingLastPaidAt = now;
        company.commercialActivity = [...(company.commercialActivity ?? []), commercialActivity({ kind: 'PAYMENT',
          amountCop: jarvisRenewal?.integration.plan?.commercialTerms?.priceCop ?? null,
          planName: jarvisRenewal?.integration.plan?.name, provider: jarvisRenewal ? 'JARVIS' : 'SIIGO' })];
        const integrations = manager.getRepository(Integration);
        if (jarvisRenewal) {
          const integration = await integrations.findOne({ where: { companyId, provider: IntegrationProvider.JARVIS, active: true }, lock: { mode: 'pessimistic_write' } });
          if (!integration || integration.planId !== jarvisRenewal.integration.planId || integration.jarvisDocumentCycle?.id !== jarvisRenewal.integration.jarvisDocumentCycle?.id)
            throw new ConflictException('El plan cambió. Actualiza el seguimiento antes de registrar el pago.');
          assignJarvisCertificateTerm(integration, jarvisRenewal.term);
          integration.subscriptionStatus = SubscriptionStatus.ACTIVE;
          integration.commercialTopUps = [];
          const limit = jarvisRenewal.integration.plan!.documentLimit;
          integration.pendingInitialDocuments = limit === null ? 0 : limit + 1;
          await integrations.save(integration);
        }
        await integrations.update({ companyId, active: true, provider: IntegrationProvider.SIIGO }, { subscriptionStatus: SubscriptionStatus.ACTIVE });
        if (company.advisorId) {
          if (!paidBy) throw new BadRequestException('No se pudo identificar quién registra el pago.');
          const paidPlans = await integrations.find({ where: { companyId, active: true }, relations: { plan: true } });
          for (const item of paidPlans) if (item.plan && (item.provider === IntegrationProvider.SIIGO || item.provider === IntegrationProvider.JARVIS))
            await recordAdvisorSale(manager, company, item.plan, `renewal-${request.expectedDueDate}-${item.provider}`, { paidBy, renewal: true });
        }
      }
      const assignedCommercial = company.commercial;
      Object.assign(company, tracking);
      if (company.advisorId) company.commercial = assignedCommercial;
      await repository.save(company);
      return company;
    });
    if (jarvisRenewal) await this.assignJarvisPlanPackage(companyId);
    const updated = (await this.companiesRepository.findAllWithIntegrations()).find(item => item.id === companyId);
    return { company: await this.mapCompanyWithDocumentQuotas(updated ?? company) };
  }

  async listCompanies(
    _adminUserId: string,
  ): Promise<ListAdminCompaniesResponseDto> {
    const companies = await this.companiesRepository.findAllWithIntegrations();

    return {
      items: await this.mapCompaniesWithDocumentQuotas(companies),
    };
  }

  async companyDetails(companyId: string) {
    const company = await this.companiesRepository.findById(companyId);
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    company.integrations = await this.integrationsRepository.findAllByCompanyId(companyId);
    return { company: await this.mapCompanyWithDocumentQuotas(company), activity: company.commercialActivity ?? [] };
  }

  async addCompanyComment(companyId: string, text: unknown) {
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 2000) throw new BadRequestException('Escribe un comentario de hasta 2.000 caracteres.');
    await this.dataSource.transaction(async manager => {
      const repository = manager.getRepository(Company);
      const company = await repository.findOne({ where: { id: companyId }, lock: { mode: 'pessimistic_write' } });
      if (!company) throw new NotFoundException('Empresa no encontrada.');
      company.commercialActivity = [...(company.commercialActivity ?? []), commercialActivity({ kind: 'COMMENT', text: text.trim() })];
      await repository.save(company);
    });
    return this.companyDetails(companyId);
  }

  async updateCompanyProfile(companyId: string, request: { name?: unknown; responsible?: AdminCompanyListItemDto['responsible']; commercial?: unknown; registrationEmail?: string }) {
    if (typeof request?.name !== 'string' || !request.name.trim() || request.name.trim().length > 200) throw new BadRequestException('Indica el nombre del cliente (máximo 200 caracteres).');
    const responsible = this.normalizeResponsible(request.responsible ?? undefined);
    if (request.commercial != null && (typeof request.commercial !== 'string' || request.commercial.trim().length > 120)) throw new BadRequestException('El comercial debe tener hasta 120 caracteres.');
    const email = request.registrationEmail === undefined ? undefined : registrationEmail(request.registrationEmail);
    await this.dataSource.transaction(async manager => {
      const repository = manager.getRepository(Company);
      const company = await repository.findOne({ where: { id: companyId }, lock: { mode: 'pessimistic_write' } });
      if (!company) throw new NotFoundException('Empresa no encontrada.');
      company.name = (request.name as string).trim();
      company.responsible = responsible;
      if (!company.advisorId) company.commercial = typeof request.commercial === 'string' ? request.commercial.trim() || null : null;
      if (email !== undefined) company.registrationEmail = email;
      await repository.save(company);
    });
    return this.companyDetails(companyId);
  }

  async createCompany(
    request: CreateAdminCompanyRequestDto,
    adminUserId: string,
    advisor?: Advisor,
  ): Promise<CreateAdminCompanyResponseDto> {
    let tracking = normalizeCompanyTracking(request?.commercial, request?.billingCycle ?? 'MONTHLY', request?.billingMonths);
    const nit = this.normalizeNit(request?.nit);
    const name = request?.name?.trim();
    const personType = this.normalizePersonType(request?.personType);
    const responsible = this.normalizeResponsible(request?.responsible);
    const integrations = this.normalizeIntegrations(request?.integrations);
    if (advisor && integrations.some(provider => provider !== IntegrationProvider.SIIGO && provider !== IntegrationProvider.JARVIS)) throw new BadRequestException('Selecciona integración Siigo o Jarvis.');
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
        'Debe seleccionar al menos una integración (SIIGO, Jarvis o Bold).',
      );
    }

    const includesSiigo = integrations.includes(IntegrationProvider.SIIGO);
    const includesJarvis = integrations.includes(IntegrationProvider.JARVIS);
    let jarvisModules = includesJarvis
      ? validateJarvisModules(request.jarvisModules === undefined ? DEFAULT_JARVIS_MODULES : request.jarvisModules)
      : null;
    const requestedDocumentTypes =
      this.planSubscriptionService.normalizeDocumentTypes(
        request?.includedDocumentTypes,
      );

    if (
      includesSiigo &&
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

    if (jarvisPlan?.commercialTerms) {
      // Read the price, period and modules from the persisted plan, never from the browser.
      jarvisModules = validateJarvisModules(jarvisPlan.commercialTerms.modules);
      if (!includesSiigo) tracking = normalizeCompanyTracking(request?.commercial, jarvisPlan.commercialTerms.billingMonths === 12 ? 'ANNUAL' : 'MONTHLY', jarvisPlan.commercialTerms.billingMonths);
    }
    const commercialTopUps = resolveJarvisTopUps(jarvisPlan, request.jarvisTopUpCodes);
    if (advisor) for (const plan of [siigoPlan, jarvisPlan]) if (plan) advisorSaleItems(plan, plan.provider === IntegrationProvider.JARVIS ? commercialTopUps : []);

    const welcomeEmail = registrationEmail(request?.registrationEmail ?? request?.responsible?.email);
    if (advisor && welcomeEmail === advisor.user.email) throw new BadRequestException('Usa el correo del cliente para su acceso. Tu correo de asesor es independiente.');
    const existingCompany = await this.companiesRepository.findByNit(nit);

    if (existingCompany) {
      throw new ConflictException(`Ya existe una empresa con el NIT ${nit}.`);
    }

    const nextPymeToken = request?.nextPymeToken?.trim() || null;
    const certificateTerm = jarvisPlan ? await this.readJarvisCertificateTerm(nit, nextPymeToken) : null;
    if (commercialTopUps.length && certificateTerm && (new Date() < new Date(certificateTerm.startsAt) || new Date() >= new Date(certificateTerm.endsAt)))
      throw new BadRequestException('La suscripción debe estar vigente según el certificado digital para aplicar la recarga inicial.');
    if (nextPymeToken) {
      await this.nextPymeApiClient.configureProductionEnvironment(nextPymeToken);
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
          ...tracking,
          ...(advisor ? { advisorId: advisor.id, commercial: advisor.user.name } : {}),
          inviteCode: generateCompanyInviteCode(),
          description: validateCompanyAiContext({ description: request?.description ?? '', rules: [] }),
          cityCode: request?.cityCode?.trim() || null,
          cityName: request?.cityName?.trim() || null,
          nextPymeToken,
          jarvisModules,
          registrationEmail: welcomeEmail,
        }),
      );

      for (const provider of integrations) {
        if (provider === IntegrationProvider.SIIGO) {
          const integration = await ensureSiigoIntegration(
            manager,
            createdCompany.id,
          );
          this.assignTechnicalKey(
            integration,
            request?.technicalKey ?? request?.jarvisCredentials?.technicalKey,
          );

          if (siigoPlan) {
            integration.plan = siigoPlan;
            integration.includedDocumentTypes = requestedDocumentTypes;
            integration.subscriptionStatus = SubscriptionStatus.ACTIVE;
            integration.subscriptionStartedAt = new Date();
          }
          await integrationsRepository.save(integration);
        }

        if (provider === IntegrationProvider.JARVIS) {
          const jarvisCredentials = this.normalizeJarvisCredentialsSeed({
            ...request?.jarvisCredentials,
            ...(request?.technicalKey?.trim()
              ? { technicalKey: request.technicalKey.trim() }
              : {}),
          });

          const integration = await ensureJarvisIntegration(
            manager,
            createdCompany.id,
            jarvisCredentials ?? {},
          );

          if (jarvisPlan) {
            integration.plan = jarvisPlan;
            integration.commercialTopUps = commercialTopUps;
            integration.pendingInitialDocuments = !nextPymeToken && jarvisPlan.documentLimit != null ? jarvisPlan.documentLimit + 1 : 0;
            integration.includedDocumentTypes = requestedDocumentTypes;
            integration.subscriptionStatus = SubscriptionStatus.ACTIVE;
            assignJarvisCertificateTerm(integration, certificateTerm!);
            const applied = commercialTopUps.filter(item => item.kind !== 'DOCUMENTS' || Boolean(nextPymeToken));
            if (applied.length) integration.topUpOperations = [{
              id: `initial-${createdCompany.id}`, status: 'APPLIED', topUps: applied,
              cycleId: integration.jarvisDocumentCycle!.id,
              periodStart: jarvisSubscriptionPeriod(integration).key, createdAt: new Date().toISOString(),
            }];
            await integrationsRepository.save(integration);
          }
        }

        // Bold no maneja plan/cupo de documentos ni credenciales propias
        // todavía (la llave de identidad la ingresa el admin cada vez desde
        // el panel, no se persiste) — solo marca que la empresa tiene esta
        // integración activa, igual que SIIGO/Jarvis lo hacen para sus
        // propios flujos.
        if (provider === IntegrationProvider.BOLD) {
          await ensureBoldIntegration(manager, createdCompany.id);
        }
      }

      if (advisor) {
        for (const plan of [siigoPlan, jarvisPlan]) if (plan) await recordAdvisorSale(manager, createdCompany, plan, `initial-${plan.provider}`, {
          topUps: plan.provider === IntegrationProvider.JARVIS ? commercialTopUps.filter(item => item.kind !== 'DOCUMENTS' || Boolean(nextPymeToken)) : [],
        });
      }
      const existingLink = advisor ? true : await userCompaniesRepository.findOne({
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

      // El documento de reserva mantiene disponibles los servicios de NextPyme
      // cuando se agota el cupo comercial; nunca se suma al plan de Jarvis.
      // Sin token propio el alta es solo en Jarvis: NextPyme aún no puede recibir
      // el paquete. Se podrá asignar desde la recarga al vincular la empresa.
      // Con token, un fallo revierte el alta para poder reintentar.
      if (nextPymeToken && jarvisPlan?.documentLimit != null) {
        const additional = commercialTopUps.filter(item => item.kind === 'DOCUMENTS').reduce((sum, item) => sum + item.units, 0);
        await this.assignNextPymePackageForNit(request.nit, jarvisPlan.documentLimit + additional + 1);
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
      ...(jarvisPlan?.documentLimit != null ? {
        nextPymePackage: nextPymeToken
          ? { status: 'ASSIGNED' as const, message: 'Paquete de documentos asignado en NextPyme.' }
          : { status: 'PENDING' as const, message: 'Empresa creada en Jarvis. Regístrala en NextPyme, configura su token propio y asigna el paquete de documentos desde la recarga.' },
      } : {}),
    };
  }

  async updateJarvisModules(companyId: string, modules: unknown): Promise<CreateAdminCompanyResponseDto> {
    const jarvisModules = validateJarvisModules(modules);
    const companies = await this.companiesRepository.findAllWithIntegrations();
    const company = companies.find(item => item.id === companyId);
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    if (!company.integrations.some(item => item.provider === IntegrationProvider.JARVIS))
      throw new BadRequestException('La empresa no tiene integración Jarvis.');
    company.jarvisModules = jarvisModules;
    return { company: this.mapCompany(await this.companiesRepository.save(company)) };
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

    const nextPymeToken = request.nextPymeToken?.trim() || null;
    const saved = await withBillingOperation(this.dataSource, companyId, 'configure', async () => {
      const [state] = await this.dataSource.query('SELECT configuration FROM jarvis_billing_environments WHERE company_id=$1', [companyId]);
      const selectedEnvironment = state?.configuration?.pending ? state.configuration.target : state?.configuration?.current;
      if (nextPymeToken) {
        if (selectedEnvironment === 2) await this.nextPymeApiClient.configureBillingEnvironment(2, nextPymeToken);
        else await this.nextPymeApiClient.configureProductionEnvironment(nextPymeToken);
      }
      company.nextPymeToken = nextPymeToken;
      return this.companiesRepository.save(company);
    });

    return {
      company: this.mapCompany(saved),
    };
  }

  async updateIdSoftware(
    companyId: string,
    request: UpdateCompanySoftwareRequestDto,
    _adminUserId: string,
  ): Promise<UpdateCompanyTechnicalKeyResponseDto> {
    const company = await this.companiesRepository.findById(companyId);

    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    const jarvis = await this.integrationsRepository.findByCompanyAndProvider(
      companyId,
      IntegrationProvider.JARVIS,
    );
    const siigo = await this.integrationsRepository.findByCompanyAndProvider(
      companyId,
      IntegrationProvider.SIIGO,
    );
    const targets = [jarvis, siigo].filter(
      (item): item is Integration => Boolean(item),
    );

    if (targets.length === 0) {
      throw new BadRequestException(
        'La empresa no tiene una integración SIIGO o Jarvis donde guardar el IDSoftware.',
      );
    }

    for (const integration of targets) {
      if (request.idSoftware != null && typeof request.idSoftware !== 'string') throw new BadRequestException('IDSoftware debe ser texto.');
      const credentials = { ...(integration.credentials ?? {}) } as Record<string, unknown>;
      const softwareId = request.idSoftware?.trim();
      if (softwareId) credentials.id_software = softwareId;
      else delete credentials.id_software;
      delete credentials.idSoftware;
      delete credentials.IDSoftware;
      integration.credentials = credentials;
      await this.integrationsRepository.save(integration);
    }

    const updated = (
      await this.companiesRepository.findAllWithIntegrations()
    ).find((item) => item.id === companyId);

    return {
      company: this.mapCompany(updated ?? company),
    };
  }

  async updateTechnicalKey(
    companyId: string,
    request: UpdateCompanyTechnicalKeyRequestDto,
    _adminUserId: string,
  ): Promise<UpdateCompanyTechnicalKeyResponseDto> {
    const company = await this.companiesRepository.findById(companyId);

    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    const jarvis = await this.integrationsRepository.findByCompanyAndProvider(
      companyId,
      IntegrationProvider.JARVIS,
    );
    const siigo = await this.integrationsRepository.findByCompanyAndProvider(
      companyId,
      IntegrationProvider.SIIGO,
    );
    const targets = [jarvis, siigo].filter(
      (item): item is Integration => Boolean(item),
    );

    if (targets.length === 0) {
      throw new BadRequestException(
        'La empresa no tiene una integración SIIGO o Jarvis donde guardar la clave técnica.',
      );
    }

    for (const integration of targets) {
      this.assignTechnicalKey(integration, request.technicalKey);
      await this.integrationsRepository.save(integration);
    }

    const updated = (
      await this.companiesRepository.findAllWithIntegrations()
    ).find((item) => item.id === companyId);

    return {
      company: this.mapCompany(updated ?? company),
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

  async updateCompanyDescription(
    companyId: string,
    request: UpdateCompanyDescriptionRequestDto,
    _adminUserId: string,
  ): Promise<UpdateCompanyDescriptionResponseDto> {
    const company = await this.companiesRepository.findById(companyId);

    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    company.description = validateCompanyAiContext({ description: request.description ?? '', rules: request.aiRules ?? readCompanyAiContext(company.description).rules });
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
    if (request.topUpCodes !== undefined) {
      if (provider !== IntegrationProvider.JARVIS) throw new BadRequestException('Las recargas del portafolio solo aplican a Jarvis.');
      return this.updateJarvisCommercialSelection(companyId, request);
    }
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

    let certificateTerm: JarvisCertificateTerm | undefined;
    if (planId && company.advisorId && (provider === IntegrationProvider.SIIGO || provider === IntegrationProvider.JARVIS))
      planSaleTerms(await this.requirePlanForProvider(planId, provider, provider));
    if (planId && provider === IntegrationProvider.JARVIS) {
      await this.requirePlanForProvider(planId, IntegrationProvider.JARVIS, 'Jarvis');
      certificateTerm = await this.readJarvisCertificateTerm(company.nit, company.nextPymeToken);
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
        jarvisCertificateTerm: certificateTerm,
        includedDocumentTypes: hasDocumentTypes
          ? request.includedDocumentTypes
          : undefined,
      });
      if (provider === IntegrationProvider.JARVIS) await this.assignJarvisPlanPackage(companyId);
      if (company.advisorId && (provider === IntegrationProvider.SIIGO || provider === IntegrationProvider.JARVIS)) await this.recordCurrentAdvisorPlan(companyId, provider);
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

  private async updateJarvisCommercialSelection(companyId: string, request: UpdateIntegrationSubscriptionRequestDto): Promise<UpdateIntegrationSubscriptionResponseDto> {
    const changingPlan = request.planId !== undefined;
    if (changingPlan && !request.planId?.trim()) throw new BadRequestException('Selecciona el plan de la empresa.');
    if (request.subscriptionStatus !== undefined || request.includedDocumentTypes !== undefined || request.restartSubscription) throw new BadRequestException('El cambio comercial no modifica el estado ni reinicia la suscripción.');
    let certificateTerm: JarvisCertificateTerm | undefined;
    let certificateCompany: Company | null = null;
    if (changingPlan) {
      const selectedPlan = await this.requirePlanForProvider(request.planId!.trim(), IntegrationProvider.JARVIS, 'Jarvis');
      resolveJarvisTopUps(selectedPlan, request.topUpCodes);
      certificateCompany = await this.companiesRepository.findById(companyId);
      if (!certificateCompany) throw new NotFoundException('Empresa no encontrada.');
      certificateTerm = await this.readJarvisCertificateTerm(certificateCompany.nit, certificateCompany.nextPymeToken);
    }
    await this.dataSource.transaction(async manager => {
      const companies = manager.getRepository(Company);
      const integrations = manager.getRepository(Integration);
      const company = await companies.findOne({ where: { id: companyId }, lock: { mode: 'pessimistic_write' } });
      if (!company) throw new NotFoundException('Empresa no encontrada.');
      const integration = await integrations.findOne({ where: { companyId, provider: IntegrationProvider.JARVIS, active: true }, lock: { mode: 'pessimistic_write' } });
      if (!integration) throw new NotFoundException('La empresa no tiene integración Jarvis.');
      const planId = changingPlan ? request.planId!.trim() : integration.planId;
      if (!planId) throw new BadRequestException('La empresa no tiene un plan Jarvis asignado.');
      const plan = await manager.getRepository(Plan).findOne({ where: { id: planId, ...(changingPlan ? { active: true } : {}) } });
      if (!plan || plan.provider !== IntegrationProvider.JARVIS) throw new BadRequestException('Selecciona un plan Jarvis disponible.');
      const topUps = resolveJarvisTopUps(plan, request.topUpCodes);
      integration.commercialTopUps = topUps;
      if (changingPlan) {
        if (company.nit !== certificateCompany!.nit || company.nextPymeToken !== certificateCompany!.nextPymeToken)
          throw new ConflictException('La vinculación de la empresa cambió durante la consulta del certificado. Intenta nuevamente.');
        if (integration.jarvisCertificateTerm && integration.jarvisCertificateTerm.checkedAt > certificateTerm!.checkedAt)
          throw new ConflictException('Otra asignación de plan actualizó el certificado. Actualiza el listado e intenta nuevamente.');
        integration.plan = plan;
        integration.subscriptionStatus = SubscriptionStatus.ACTIVE;
        assignJarvisCertificateTerm(integration, certificateTerm!);
        integration.commercialTopUps = [];
        integration.pendingInitialDocuments = plan.documentLimit === null ? 0 : plan.documentLimit + 1;
        if (plan.commercialTerms) {
          company.jarvisModules = validateJarvisModules(plan.commercialTerms.modules);
          company.billingMonths = plan.commercialTerms.billingMonths;
          company.billingCycle = company.billingMonths === 12 ? 'ANNUAL' : company.billingMonths === 1 ? 'MONTHLY' : null;
          await companies.save(company);
        }
      }
      await integrations.save(integration);
      if (changingPlan) await recordAdvisorSale(manager, company, plan, `plan-${integration.jarvisDocumentCycle!.id}`);
    });
    if (changingPlan) await this.assignJarvisPlanPackage(companyId);
    return this.companyCommercialState(companyId);
  }

  private async recordCurrentAdvisorPlan(companyId: string, provider: IntegrationProvider) {
    await this.dataSource.transaction(async manager => {
      const company = await manager.getRepository(Company).findOne({ where: { id: companyId }, lock: { mode: 'pessimistic_write' } });
      const integration = await manager.getRepository(Integration).findOne({ where: { companyId, provider }, relations: { plan: true } });
      if (company?.advisorId && integration?.plan) await recordAdvisorSale(manager, company, integration.plan,
        `plan-${integration.jarvisDocumentCycle?.id ?? integration.subscriptionStartedAt?.toISOString() ?? integration.id}`);
    });
  }

  private async companyCommercialState(companyId: string) {
    const company = await this.companiesRepository.findById(companyId);
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    company.integrations = await this.integrationsRepository.findAllByCompanyId(companyId);
    const mapped = await this.mapCompanyWithDocumentQuotas(company);
    const integration = mapped.integrations.find(item => item.provider === IntegrationProvider.JARVIS)!;
    return { company: mapped, integration };
  }

  async updateSiigoDocumentQuotas(
    companyId: string,
    request: UpdateSiigoDocumentQuotasRequestDto,
  ): Promise<UpdateSiigoDocumentQuotasResponseDto> {
    const company = await this.companiesRepository.findById(companyId);

    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    if (
      request.purchaseInvoice === undefined &&
      request.supportDocument === undefined
    ) {
      throw new BadRequestException(
        'Debe indicar al menos un cupo (purchaseInvoice y/o supportDocument).',
      );
    }

    const integration =
      await this.integrationsRepository.findByCompanyAndProviderWithPlan(
        companyId,
        IntegrationProvider.SIIGO,
      );

    if (!integration) {
      throw new NotFoundException(
        'La integración SIIGO no existe para esta empresa.',
      );
    }

    const currentLimits = integration.documentLimits ?? {};
    const purchaseInvoice =
      request.purchaseInvoice !== undefined
        ? request.purchaseInvoice
        : (currentLimits.PURCHASE_INVOICE ?? null);
    const supportDocument =
      request.supportDocument !== undefined
        ? request.supportDocument
        : (currentLimits.SUPPORT_DOCUMENT ?? null);

    await this.planSubscriptionService.saveSiigoDocumentLimits(companyId, {
      purchaseInvoice,
      supportDocument,
    });

    const updated =
      await this.integrationsRepository.findByCompanyAndProviderWithPlan(
        companyId,
        IntegrationProvider.SIIGO,
      );

    if (!updated) {
      throw new BadRequestException('No se pudieron actualizar los cupos.');
    }

    return {
      integration: this.mapIntegration(updated),
    };
  }

  private mapPlan(plan: Plan): AdminPlanDto {
    return {
      commissionClass: plan.commissionClass ?? null,
      salePriceCop: plan.commercialTerms?.priceCop ?? (plan.salePriceCop == null ? null : Number(plan.salePriceCop)),
      id: plan.id,
      name: plan.name,
      code: plan.code,
      provider: plan.provider,
      documentLimit: plan.documentLimit,
      commercialTerms: plan.commercialTerms ?? null,
      includedDocumentTypes: plan.includedDocumentTypes ?? [],
    };
  }

  private mapIntegration(integration: Integration): AdminIntegrationItemDto {
    return {
      commercialTopUps: integration.commercialTopUps ?? [],
      topUpOperations: integration.topUpOperations ?? [],
      pendingInitialDocuments: integration.pendingInitialDocuments ?? 0,
      ...(integration.provider === IntegrationProvider.JARVIS ? { jarvisDocumentCycle: integration.jarvisDocumentCycle ?? null } : {}),
      ...(integration.provider === IntegrationProvider.JARVIS ? { jarvisCertificateTerm: integration.jarvisCertificateTerm ?? null } : {}),
      id: integration.id,
      provider: integration.provider,
      active: integration.active,
      subscriptionStatus: integration.subscriptionStatus,
      subscriptionStartedAt:
        integration.subscriptionStartedAt?.toISOString() ?? null,
      includedDocumentTypes:
        this.planSubscriptionService.resolveIncludedDocumentTypes(integration),
      documentLimits:
        integration.provider === IntegrationProvider.SIIGO
          ? (integration.documentLimits ?? null)
          : null,
      plan: integration.plan ? this.mapPlan(integration.plan) : null,
    };
  }

  private async mapCompaniesWithDocumentQuotas(companies: Company[]): Promise<AdminCompanyListItemDto[]> {
    const items: AdminCompanyListItemDto[] = [];
    // Bound parallel quota queries so larger client lists do not exhaust the pool.
    for (let offset = 0; offset < companies.length; offset += 10) {
      items.push(...await Promise.all(companies.slice(offset, offset + 10).map(company => this.mapCompanyWithDocumentQuotas(company))));
    }
    return items;
  }

  private async mapCompanyWithDocumentQuotas(company: Company): Promise<AdminCompanyListItemDto> {
    const item = this.mapCompany(company);
    await Promise.all(item.integrations.map(async integration => {
      const source = company.integrations?.find(value => value.id === integration.id);
      if (integration.provider === IntegrationProvider.BOLD || (!integration.plan && !source?.documentLimits)) return;
      const quota = await this.planSubscriptionService.getSubscription(company.id, integration.provider);
      integration.documentQuota = {
        documentLimit: quota.documentLimit,
        documentsUsed: quota.documentsUsed,
        remaining: quota.remaining,
      };
    }));
    return item;
  }

  private mapCompany(company: Company): AdminCompanyListItemDto {
    return {
      id: company.id,
      registrationEmail: company.registrationEmail ?? null,
      advisorId: company.advisorId ?? null,
      nit: company.nit,
      jarvisModules: company.jarvisModules ?? [...DEFAULT_JARVIS_MODULES],
      name: company.name,
      email: [...(company.userCompanies ?? [])]
        .filter((link) => link.user?.active && link.user.role === UserRole.USER && link.user.email?.trim())
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
        [0]?.user.email.trim() ?? null,
      description: readCompanyAiContext(company.description).description || null,
      aiRules: readCompanyAiContext(company.description).rules,
      personType: company.personType,
      responsible: company.responsible,
      commercial: company.commercial ?? null,
      billingCycle: company.billingCycle ?? null,
      billingMonths: company.billingMonths ?? billingMonthsFromCycle(company.billingCycle),
      subscriptionDueDate: companyTrackingDueDate(company),
      trackingPeriodStart: company.trackingPeriodStart ?? null,
      trackingLastPaidAt: company.trackingLastPaidAt?.toISOString() ?? null,
      createdAt: company.createdAt.toISOString(),
      inviteCode: company.inviteCode,
      nextPymeToken: company.nextPymeToken,
      technicalKey: this.readTechnicalKey(company),
      idSoftware: this.credentialField(company.integrations?.find(item => item.active && item.provider === IntegrationProvider.JARVIS)?.credentials ?? company.integrations?.find(item => item.active && item.provider === IntegrationProvider.SIIGO)?.credentials, 'id_software', 'idSoftware'),
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

      if (provider === IntegrationProvider.BOLD) {
        normalized.push(IntegrationProvider.BOLD);
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
      !credentials.technical_key &&
      !credentials.token_nextpyme
    ) {
      return null;
    }

    return credentials;
  }

  private normalizeNit(nit?: string): string {
    return nit?.replace(/[^\d]/g, '') ?? '';
  }

  private readTechnicalKey(company: Company): string | null {
    const integrations = company.integrations ?? [];
    const preferred =
      integrations.find(
        (item) => item.provider === IntegrationProvider.JARVIS && item.active,
      ) ??
      integrations.find(
        (item) => item.provider === IntegrationProvider.SIIGO && item.active,
      );

    return this.technicalKeyFromCredentials(preferred?.credentials);
  }

  private assignTechnicalKey(
    integration: Integration,
    value?: string | null,
  ): void {
    const technicalKey = value?.trim() || null;
    const credentials = {
      ...((integration.credentials ?? {}) as Record<string, unknown>),
    };

    if (technicalKey) {
      credentials.technical_key = technicalKey;
    } else {
      delete credentials.technical_key;
    }

    integration.credentials = credentials as Integration['credentials'];
  }

  private technicalKeyFromCredentials(
    credentials?: Integration['credentials'] | null,
  ): string | null {
    return this.credentialField(credentials, 'technical_key', 'technicalKey');
  }

  private credentialField(
    credentials: Integration['credentials'] | null | undefined,
    snake: string,
    camel: string,
  ): string | null {
    if (!credentials || typeof credentials !== 'object') {
      return null;
    }

    const raw = credentials as Record<string, unknown>;
    const value = String(raw[snake] ?? raw[camel] ?? '').trim();
    return value || null;
  }
}
