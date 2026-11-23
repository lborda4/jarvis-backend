import { AdvisorPortalService } from './advisor-portal.service';
import { Body, Controller, ForbiddenException, Get, Post, Query, UseGuards, Injectable, CanActivate, ExecutionContext, Param, ParseUUIDPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { Advisor } from '../auth/entities/advisor.entity';
import { UserRole } from '../auth/enums/user-role.enum';
import { AdminService } from '../admin/admin.service';
import { CreateAdminCompanyRequestDto } from '../admin/dto/admin-company.dto';
import { RegistrationInvitationService } from '../auth/services/registration-invitation.service';
import { AdvisorSalesService } from './advisor-sales.service';
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
  private get portal() { return new AdvisorPortalService(this.db, this.admin, this.sales, this.invitations); }
  private async profile(user: AuthenticatedUser) {
    const advisor = await this.db.getRepository(Advisor).findOne({ where: { userId: user.userId }, relations: { user: true } });
    if (!advisor?.registeredAt || !advisor.user.active || advisor.user.role !== UserRole.ADVISOR) throw new ForbiddenException('La cuenta de asesor no está activa.');
    return advisor;
  }
  @Get('catalog') async catalog(@CurrentUser() user: AuthenticatedUser) {
    await this.profile(user);
    return this.portal.catalog();
  }
  @Get('companies/lookup-name') async lookup(@CurrentUser() user: AuthenticatedUser, @Query('nit') nit: string) {
    await this.profile(user); return this.admin.lookupCompanyName(nit ?? '');
  }
  @Get('dashboard') async dashboard(@CurrentUser() user: AuthenticatedUser, @Query('month') month?: string) {
    const advisor = await this.profile(user);
    return this.portal.dashboard(advisor, month);
  }
  @Get('commissions') async commissions(@CurrentUser() user: AuthenticatedUser, @Query('month') month?: string) {
    return this.sales.report(month, (await this.profile(user)).id);
  }
  @Post('companies') async create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateAdminCompanyRequestDto) {
    const advisor = await this.profile(user);
    return this.portal.create(advisor, user, input);
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
