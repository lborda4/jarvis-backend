import { Body, Controller, Get, Param, ParseUUIDPipe, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { getAuthenticatedCompanyId } from '../auth/helpers/authenticated-company.helper';
import { PayrollGuard } from './payroll.guard';
import { PayrollPayslipsService } from './payroll-payslips.service';

@Controller('integrations/jarvis/payroll/payslips')
@UseGuards(PayrollGuard)
export class PayrollPayslipsController {
  constructor(private readonly service: PayrollPayslipsService) {}
  @Post('recipients') recipients(@CurrentUser() user: AuthenticatedUser, @Body() body: { ids?: unknown }) {
    return this.service.recipients(getAuthenticatedCompanyId(user), body?.ids);
  }
  @Get(':id/pdf') async pdf(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const file = await this.service.pdf(getAuthenticatedCompanyId(user), id);
    return new StreamableFile(file.buffer, { type: 'application/pdf', disposition: `attachment; filename="${file.filename}"` });
  }
  @Post('zip') async zip(@CurrentUser() user: AuthenticatedUser, @Body() body: { ids?: unknown }) {
    const file = await this.service.zip(getAuthenticatedCompanyId(user), body?.ids);
    return new StreamableFile(file.buffer, { type: 'application/zip', disposition: `attachment; filename="${file.filename}"` });
  }
  @Post(':id/email') email(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { requestId?: unknown }) {
    return this.service.email(getAuthenticatedCompanyId(user), id, body?.requestId);
  }
}
