import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { InvoiceAppearanceService } from './invoice-appearance.service';

@ApiTags('integrations/jarvis')
@Controller('integrations/jarvis/invoice-appearance')
export class InvoiceAppearanceController {
  constructor(private readonly appearance: InvoiceAppearanceService) {}
  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.appearance.get(getAuthenticatedCompanyId(user));
  }
  @Put()
  save(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.appearance.save(getAuthenticatedCompanyId(user), input);
  }
}
