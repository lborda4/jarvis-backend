import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AdvisorAccountService, type AdvisorInput } from '../auth/services/advisor-account.service';
import { AdminGuard } from './guards/admin.guard';

@Controller('admin/advisors')
@UseGuards(AdminGuard)
export class AdminAdvisorsController {
  constructor(private readonly advisors: AdvisorAccountService) {}
  @Get() list() { return this.advisors.list(); }
  @Post() create(@Body() input: AdvisorInput) { return this.advisors.create(input); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() input: AdvisorInput) { return this.advisors.update(id, input); }
  @Post(':id/access') sendAccess(@Param('id', ParseUUIDPipe) id: string) { return this.advisors.sendAccess(id); }
  @Post(':id/clients/:companyId') assign(@Param('id', ParseUUIDPipe) id: string, @Param('companyId', ParseUUIDPipe) companyId: string) { return this.advisors.assignClient(id, companyId); }
  @Delete(':id/clients/:companyId') remove(@Param('id', ParseUUIDPipe) id: string, @Param('companyId', ParseUUIDPipe) companyId: string) { return this.advisors.assignClient(id, companyId, true); }
}
