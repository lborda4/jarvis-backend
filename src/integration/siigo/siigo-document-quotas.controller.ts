import { Controller, Get, Inject, forwardRef } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { PlanSubscriptionService } from '../../plan/plan-subscription.service';
import { IntegrationProvider } from '../enums/integration-provider.enum';

@ApiTags('siigo')
@Controller('integrations/siigo/document-quotas')
export class SiigoDocumentQuotasController {
  constructor(
    @Inject(forwardRef(() => PlanSubscriptionService))
    private readonly subscriptions: PlanSubscriptionService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Consultar cupos de documentos SIIGO',
    description:
      'Solo lectura para el cliente. Los cupos se configuran desde admin.',
  })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.getSubscription(
      getAuthenticatedCompanyId(user),
      IntegrationProvider.SIIGO,
    );
  }
}
