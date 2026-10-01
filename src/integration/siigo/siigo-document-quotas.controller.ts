import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { PlanSubscriptionService } from '../../plan/plan-subscription.service';
import { IntegrationProvider } from '../enums/integration-provider.enum';
@Controller('integrations/siigo/document-quotas')
export class SiigoDocumentQuotasController {
  constructor(private readonly subscriptions: PlanSubscriptionService) {}
  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.getSubscription(getAuthenticatedCompanyId(user), IntegrationProvider.SIIGO);
  }
  @Put()
  @UseGuards(AdminGuard)
  save(@CurrentUser() user: AuthenticatedUser, @Body() body: { purchaseInvoice: number | null; supportDocument: number | null }) {
    return this.subscriptions.saveSiigoDocumentLimits(getAuthenticatedCompanyId(user), body);
  }
}
