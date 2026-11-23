import { clientLifecycleStatus } from '../admin/client-lifecycle';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { Advisor } from '../auth/entities/advisor.entity';
import { Company } from '../company/entities/company.entity';
import { AdminService } from '../admin/admin.service';
import { CreateAdminCompanyRequestDto } from '../admin/dto/admin-company.dto';
import { RegistrationInvitationService } from '../auth/services/registration-invitation.service';
import { AdvisorSalesService } from './advisor-sales.service';
import { COMMISSION_RATES, RENEWAL_COMMISSION_RATES } from './advisor-commission';
import { TOP_UP_COMMISSION_BASIS } from './commission-catalog';


@Injectable()
export class AdvisorPortalService {
  constructor(private readonly db: DataSource, private readonly admin: AdminService, private readonly sales: AdvisorSalesService, private readonly invitations: RegistrationInvitationService) {}
  async profile(id: string): Promise<Advisor> {
    const advisor = await this.db.getRepository(Advisor).findOne({ where: { id }, relations: { user: true } });
    if (!advisor) throw new NotFoundException('Asesor no encontrado.');
    return advisor;
  }
  async catalog() {
    const [plans, cities] = await Promise.all([this.admin.listPlans(), this.admin.listCities()]);
    return { plans: plans.items.filter(item => item.provider === 'SIIGO' || item.provider === 'JARVIS'), cities: cities.items,
      topUps: this.admin.listJarvisTopUps().items, commissionRates: COMMISSION_RATES, renewalCommissionRates: RENEWAL_COMMISSION_RATES, topUpCommissionBasis: TOP_UP_COMMISSION_BASIS };
  }
  async dashboard(advisor: Advisor, month?: string) {
    const clients = await this.db.getRepository(Company).find({ where: { advisorId: advisor.id }, relations: { integrations: { plan: true } }, order: { createdAt: 'DESC' } });
    const commissions = await this.sales.report(month, advisor.id);
    return { advisor: { id: advisor.id, name: advisor.user.name }, clients: await Promise.all(clients.map(async company => ({ id: company.id, name: company.name, nit: company.nit,
      createdAt: company.createdAt.toISOString(), clientStatus: await clientLifecycleStatus(company, this.db),
      paymentStatus: commissions.pending.some(sale => sale.companyId === company.id) ? 'PENDING' : company.commercialActivity?.some(item => item.kind === 'PAYMENT') ? 'PAID' : 'PENDING', plans: company.integrations.filter(item => item.active && item.plan).map(item => ({ name: item.plan!.name, provider: item.provider })) }))),
      commissions };
  }
  async create(advisor: Advisor, user: AuthenticatedUser, input: CreateAdminCompanyRequestDto) {
    const response = await this.admin.createCompany(input, user.userId, advisor);
    response.welcome = await this.invitations.send(response.company.id, response.company.registrationEmail, user.userId);
    // Return only the creation receipt; operational tokens are never exposed in this panel.
    response.company = { ...response.company, nextPymeToken: null, technicalKey: null, inviteCode: '', idSoftware: null };
    return response;
  }
}
