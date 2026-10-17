import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StreamableFile, BadRequestException } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { PayrollGuard } from './payroll.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { getAuthenticatedCompanyId } from '../auth/helpers/authenticated-company.helper';
import { PayrollService } from './payroll.service';
@Controller('integrations/jarvis/payroll')
@UseGuards(PayrollGuard)
export class PayrollController {
  constructor(private readonly service: PayrollService) {}
  @Get('catalogs') catalogs(@CurrentUser() u: AuthenticatedUser) {
    return this.service.workerCatalogs(getAuthenticatedCompanyId(u));
  }
  @Get('bootstrap') bootstrap(@CurrentUser() u: AuthenticatedUser) {
    return this.service.bootstrap(getAuthenticatedCompanyId(u));
  }
  @Put('employees/:id') employee(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: any,
  ) {
    return this.service.saveEmployee(
      getAuthenticatedCompanyId(u),
      u.userId,
      id,
      data,
    );
  }
  @Put('positions/:id') position(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: any,
  ) {
    return this.service.savePosition(
      getAuthenticatedCompanyId(u),
      u.userId,
      id,
      data,
    );
  }
  @Post('parameters') parameters(
    @CurrentUser() u: AuthenticatedUser,
    @Body() data: any,
  ) {
    return this.service.saveParameters(
      getAuthenticatedCompanyId(u),
      u.userId,
      data,
    );
  }
  @Put('settings') settings(
    @CurrentUser() u: AuthenticatedUser,
    @Body() data: any,
  ) {
    return this.service.saveSettings(
      getAuthenticatedCompanyId(u),
      u.userId,
      data,
    );
  }
  @Post('environment') environment(@CurrentUser() u: AuthenticatedUser) {
    return this.service.configureEnvironment(
      getAuthenticatedCompanyId(u),
      u.userId,
    );
  }
  @Get('documents') list(
    @CurrentUser() u: AuthenticatedUser,
    @Query('period') period?: string,
  ) {
    return this.service.list(getAuthenticatedCompanyId(u), period);
  }
  @Put('periods/:id') createPeriod(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: any,
  ) {
    return this.service.createPeriod(
      getAuthenticatedCompanyId(u),
      u.userId,
      id,
      request,
    );
  }
  @Get('documents/:id') get(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(getAuthenticatedCompanyId(u), id);
  }
  @Put('documents/:id') save(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: any,
  ) {
    return this.service.saveDocument(
      getAuthenticatedCompanyId(u),
      u.userId,
      id,
      data,
    );
  }
  @Post('documents/:id/validate') validate(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.validate(getAuthenticatedCompanyId(u), id);
  }
  @Post('documents/:id/send') send(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.send(getAuthenticatedCompanyId(u), u.userId, id);
  }
  @Post('documents/:id/status') status(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.refreshStatus(
      getAuthenticatedCompanyId(u),
      u.userId,
      id,
    );
  }
  @Get('documents/:id/files/:kind') async file(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
  ) {
    if (kind !== 'pdf' && kind !== 'xml')
      throw new BadRequestException('Formato inválido.');
    const file = await this.service.download(
      getAuthenticatedCompanyId(u),
      id,
      kind,
    );
    return new StreamableFile(file.buffer, {
      type: kind === 'pdf' ? 'application/pdf' : 'application/xml',
      disposition: `attachment; filename="${file.filename}"`,
    });
  }
}
