import { BadRequestException, Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { IntegrationsRepository } from '../integration/repositories/integrations.repository';
import { subscriptionAccess } from './subscription-access';

@Controller('subscriptions')
export class SubscriptionAccessController {
  constructor(private readonly integrations: IntegrationsRepository) {}
  @Get('access')
  async access(@CurrentUser() user: AuthenticatedUser) {
    if (!user.companyId) throw new BadRequestException('Selecciona una empresa.');
    const integrations = await this.integrations.findAllByCompanyId(user.companyId);
    return { items: integrations.filter(item => ['SIIGO', 'JARVIS'].includes(item.provider)).map(item => subscriptionAccess(item)) };
  }
}
