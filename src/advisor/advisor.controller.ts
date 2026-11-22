import { Body, Controller, ForbiddenException, Get, Post, Query, UseGuards, Injectable, CanActivate, ExecutionContext, Param, ParseUUIDPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { Advisor } from '../auth/entities/advisor.entity';
import { UserRole } from '../auth/enums/user-role.enum';
import { Company } from '../company/entities/company.entity';
import { AdminService } from '../admin/admin.service';
import { CreateAdminCompanyRequestDto } from '../admin/dto/admin-company.dto';
import { RegistrationInvitationService } from '../auth/services/registration-invitation.service';
import { AdvisorSalesService } from './advisor-sales.service';
import { COMMISSION_RATES, RENEWAL_COMMISSION_RATES } from './advisor-commission';
import { TOP_UP_COMMISSION_BASIS } from './commission-catalog';
import { AdminGuard } from '../admin/guards/admin.guard';

@Injectable()
export class AdvisorGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest().user?.role !== UserRole.ADVISOR) throw new ForbiddenException('Acceso exclusivo para asesores.');
    return true;
  }
}
@Controller('advisor')
@UseGuards(AdvisorGuard)
export class AdvisorController {
  constructor(private readonly db: DataSource, private readonly admin: AdminService, private readonly sales: AdvisorSalesService,
    private readonly invitations: RegistrationInvitationService) {}
  private async profile(user: AuthenticatedUser) {
    const advisor = await this.db.getRepository(Advisor).findOne({ where: { userId: user.userId }, relations: { user: true } });
    if (!advisor?.registeredAt || !advisor.user.active || advisor.user.role !== UserRole.ADVISOR) throw new ForbiddenException('La cuenta de asesor no está activa.');
    return advisor;
  }
  @Get('catalog') async catalog(@CurrentUser() user: AuthenticatedUser) {
    await this.profile(user);
    const [plans, cities] = await Promise.all([this.admin.listPlans(), this.admin.listCities()]);
    return { plans: plans.items.filter(item => item.provider === 'SIIGO' || item.provider === 'JARVIS'), cities: cities.items,
      topUps: this.admin.listJarvisTopUps().items, commissionRates: COMMISSION_RATES, renewalCommissionRates: RENEWAL_COMMISSION_RATES, topUpCommissionBasis: TOP_UP_COMMISSION_BASIS };
  }
  @Get('companies/lookup-name') async lookup(@CurrentUser() user: AuthenticatedUser, @Query('nit') nit: string) {
    await this.profile(user); return this.admin.lookupCompanyName(nit ?? '');
  }
  @Get('dashboard') async dashboard(@CurrentUser() user: AuthenticatedUser, @Query('month') month?: string) {
    const advisor = await this.profile(user);
    const clients = await this.db.getRepository(Company).find({ where: { advisorId: advisor.id }, relations: { integrations: { plan: true } }, order: { createdAt: 'DESC' } });
    return { advisor: { id: advisor.id, name: advisor.user.name }, clients: clients.map(company => ({ id: company.id, name: company.name, nit: company.nit,
      createdAt: company.createdAt.toISOString(), plans: company.integrations.filter(item => item.active && item.plan).map(item => ({ name: item.plan!.name, provider: item.provider })) })),
      commissions: await this.sales.report(month, advisor.id) };
  }
  @Get('commissions') async commissions(@CurrentUser() user: AuthenticatedUser, @Query('month') month?: string) {
    return this.sales.report(month, (await this.profile(user)).id);
  }
  @Post('companies') async create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateAdminCompanyRequestDto) {
    const advisor = await this.profile(user);
    const response = await this.admin.createCompany(input, user.userId, advisor);
    response.welcome = await this.invitations.send(response.company.id, response.company.registrationEmail, user.userId);
    // Return only the creation receipt; operational tokens are never exposed in this panel.
    response.company = { ...response.company, nextPymeToken: null, technicalKey: null, inviteCode: '', idSoftware: null };
    return response;
  }
}
@Controller('admin/advisor-sales')
@UseGuards(AdminGuard)
export class AdminAdvisorSalesController {
  constructor(private readonly sales: AdvisorSalesService) {}
  @Get() report(@Query('month') month?: string, @Query('advisorId') advisorId?: string, @Query('companyId') companyId?: string) {
    return this.sales.report(month, advisorId, companyId);
  }
  @Post(':id/payment') payment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.sales.registerPayment(id, user.userId); }
}
