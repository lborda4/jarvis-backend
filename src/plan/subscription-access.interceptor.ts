import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { IntegrationsRepository } from '../integration/repositories/integrations.repository';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { isSubscriptionMutation, subscriptionAccess } from './subscription-access';

@Injectable()
export class SubscriptionAccessInterceptor implements NestInterceptor {
  constructor(private readonly integrations: IntegrationsRepository) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest();
    if (!request.user?.companyId || !isSubscriptionMutation(request.method, request.originalUrl ?? request.url)) return next.handle();
    const path: string = request.originalUrl ?? request.url;
    const rows = await this.integrations.findAllByCompanyId(request.user.companyId);
    const explicitProvider = path.startsWith('/integrations/siigo') ? IntegrationProvider.SIIGO
      : path.startsWith('/integrations/jarvis') || path.startsWith('/payroll') ? IntegrationProvider.JARVIS : null;
    const integration = explicitProvider ? rows.find(item => item.provider === explicitProvider)
      : rows.find(item => item.provider === IntegrationProvider.SIIGO) ?? rows.find(item => item.provider === IntegrationProvider.JARVIS);
    if (integration && !subscriptionAccess(integration).canWrite) {
      throw new ForbiddenException(integration.provider === IntegrationProvider.SIIGO
        ? 'La suscripción SIIGO está vencida o inactiva. Solo puedes consultar documentos; no puedes importar ni realizar cambios.'
        : 'La suscripción Jarvis está vencida o inactiva. Puedes consultar documentos, pero no enviar ni realizar cambios.');
    }
    return next.handle();
  }
}
