import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from './guards/admin.guard';
import { AdminBillingEnvironmentService } from './admin-billing-environment.service';

export class AdminBillingEnvironmentDto {
  environment: number;
}

@Controller('admin/companies/:companyId/jarvis/billing-environment')
@UseGuards(AdminGuard)
export class AdminBillingEnvironmentController {
  constructor(private readonly service: AdminBillingEnvironmentService) {}
  @Get()
  status(@Param('companyId') companyId: string) { return this.service.status(companyId); }
  @Put()
  configure(@Param('companyId') companyId: string, @Body() request: AdminBillingEnvironmentDto) {
    return this.service.configure(companyId, request?.environment);
  }
}
