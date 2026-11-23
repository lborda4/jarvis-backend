import { Query } from '@nestjs/common';
import { AdvisorPortalService } from '../advisor/advisor-portal.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateAdminCompanyRequestDto } from './dto/admin-company.dto';
import { AdminService } from './admin.service';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AdvisorAccountService, type AdvisorInput } from '../auth/services/advisor-account.service';
import { AdminGuard } from './guards/admin.guard';

@Controller('admin/advisors')
@UseGuards(AdminGuard)
export class AdminAdvisorsController {
  constructor(private readonly advisors: AdvisorAccountService, private readonly portal: AdvisorPortalService, private readonly admin: AdminService) {}
  @Get('portal/catalog') catalog() { return this.portal.catalog(); }
  @Get('portal/lookup-name') lookup(@Query('nit') nit: string) { return this.admin.lookupCompanyName(nit ?? ''); }
  @Get(':id/dashboard') async dashboard(@Param('id', ParseUUIDPipe) id: string, @Query('month') month?: string) {
    return this.portal.dashboard(await this.portal.profile(id), month);
  }
  @Post(':id/companies') async createClient(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Body() input: CreateAdminCompanyRequestDto) {
    return this.portal.create(await this.portal.profile(id), user, input);
  }
  @Get() list() { return this.advisors.list(); }
  @Post() create(@Body() input: AdvisorInput) { return this.advisors.create(input); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() input: AdvisorInput) { return this.advisors.update(id, input); }
  @Post(':id/access') sendAccess(@Param('id', ParseUUIDPipe) id: string) { return this.advisors.sendAccess(id); }
  @Post(':id/clients/:companyId') assign(@Param('id', ParseUUIDPipe) id: string, @Param('companyId', ParseUUIDPipe) companyId: string) { return this.advisors.assignClient(id, companyId); }
  @Delete(':id/clients/:companyId') remove(@Param('id', ParseUUIDPipe) id: string, @Param('companyId', ParseUUIDPipe) companyId: string) { return this.advisors.assignClient(id, companyId, true); }
}
