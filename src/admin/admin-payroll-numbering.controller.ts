import { Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from './guards/admin.guard';
import { AdminPayrollNumberingService } from './admin-payroll-numbering.service';

@Controller('admin/companies/:companyId/jarvis/payroll-numbering')
@UseGuards(AdminGuard)
export class AdminPayrollNumberingController {
  constructor(private readonly service: AdminPayrollNumberingService) {}
  @Get()
  status(@Param('companyId') companyId: string) { return this.service.status(companyId); }
  @Put()
  configure(@Param('companyId') companyId: string) { return this.service.configure(companyId); }
}
