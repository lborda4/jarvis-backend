import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { JarvisReportsService } from './jarvis-reports.service';
import type { ReportQuery } from './jarvis-reports.types';

@Controller('integrations/jarvis/reports')
export class JarvisReportsController {
  constructor(private readonly reports: JarvisReportsService) {}
  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportQuery,
  ) {
    const result = await this.reports.export(
      getAuthenticatedCompanyId(user),
      query,
    );
    return new StreamableFile(result.buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${result.filename}"`,
    });
  }
  @Get()
  query(@CurrentUser() user: AuthenticatedUser, @Query() query: ReportQuery) {
    return this.reports.query(getAuthenticatedCompanyId(user), query);
  }
}
