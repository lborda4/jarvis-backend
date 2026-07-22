import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserCompany } from '../auth/entities/user-company.entity';
import { Company } from '../company/entities/company.entity';
import { CompaniesRepository } from '../company/repositories/companies.repository';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import {
  ensureJarvisIntegration,
  ensureSiigoIntegration,
} from '../integration/helpers/integration-setup.helper';
import { Plan } from '../plan/entities/plan.entity';
import { PlansRepository } from '../plan/repositories/plans.repository';
import type { CompanyResponsible } from '../company/interfaces/company-responsible.interface';
import {
  AdminCompanyListItemDto,
  AdminPlanDto,
  CreateAdminCompanyRequestDto,
  CreateAdminCompanyResponseDto,
  ListAdminCompaniesResponseDto,
  ListAdminPlansResponseDto,
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
  ) {}

  async listPlans(): Promise<ListAdminPlansResponseDto> {
    const plans = await this.plansRepository.findAllActive();

    return {
      items: plans.map((plan) => this.mapPlan(plan)),
    };
  }

  async listCompanies(adminUserId: string): Promise<ListAdminCompaniesResponseDto> {
    const companies =
      await this.companiesRepository.findLinkedWithIntegrations(adminUserId);

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
    const responsible = this.normalizeResponsible(request?.responsible);
    const integrations = this.normalizeIntegrations(request?.integrations);
    const companyPlanId = request?.companyPlanId?.trim();

    if (!nit) {
      throw new BadRequestException('El NIT es obligatorio.');
    }

    if (!name) {
      throw new BadRequestException('El nombre de la empresa es obligatorio.');
    }

    if (!responsible) {
      throw new BadRequestException(
        'Los datos de la persona a cargo (nombre, teléfono y correo) son obligatorios.',
      );
    }

    if (!companyPlanId) {
      throw new BadRequestException('Debe seleccionar un plan para la empresa.');
    }

    if (integrations.length === 0) {
      throw new BadRequestException(
        'Debe seleccionar al menos una integración (SIIGO, Jarvis o ambas).',
      );
    }

    const plan = await this.plansRepository.findById(companyPlanId);

    if (!plan) {
      throw new NotFoundException('El plan seleccionado no existe o está inactivo.');
    }

    const existingCompany = await this.companiesRepository.findByNit(nit);

    if (existingCompany) {
      throw new ConflictException(`Ya existe una empresa con el NIT ${nit}.`);
    }

    const company = await this.dataSource.transaction(async (manager) => {
      const companiesRepository = manager.getRepository(Company);
      const userCompaniesRepository = manager.getRepository(UserCompany);

      const createdCompany = await companiesRepository.save(
        companiesRepository.create({
          nit,
          name,
          responsible,
          companyPlanId: plan.id,
        }),
      );

      for (const provider of integrations) {
        if (provider === IntegrationProvider.SIIGO) {
          await ensureSiigoIntegration(manager, createdCompany.id);
        }

        if (provider === IntegrationProvider.JARVIS) {
          await ensureJarvisIntegration(manager, createdCompany.id);
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
        relations: { integrations: true, companyPlan: true },
      });
    });

    if (!company) {
      throw new BadRequestException('No se pudo crear la empresa.');
    }

    return {
      company: this.mapCompany(company),
    };
  }

  private mapPlan(plan: Plan): AdminPlanDto {
    return {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      documentLimit: plan.documentLimit,
    };
  }

  private mapCompany(company: Company): AdminCompanyListItemDto {
    return {
      id: company.id,
      nit: company.nit,
      name: company.name,
      responsible: company.responsible,
      createdAt: company.createdAt.toISOString(),
      companyPlan: company.companyPlan ? this.mapPlan(company.companyPlan) : null,
      integrations: (company.integrations ?? [])
        .filter((integration) => integration.active)
        .map((integration) => ({
          provider: integration.provider,
          active: integration.active,
        }))
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

  private normalizeResponsible(
    responsible?: Partial<CompanyResponsible>,
  ): CompanyResponsible | null {
    const name = responsible?.name?.trim();
    const phone = responsible?.phone?.trim();
    const email = responsible?.email?.trim().toLowerCase();

    if (!name || !phone || !email) {
      return null;
    }

    return { name, phone, email };
  }

  private normalizeNit(nit?: string): string {
    return nit?.replace(/[^\d]/g, '') ?? '';
  }
}
