import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../auth/helpers/authenticated-company.helper';
import { IntegrationProvidersResponseDto } from './dto/integration-providers.dto';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get('providers')
  @ApiOperation({
    summary: 'Proveedores activos de la empresa',
    description:
      'Lista los proveedores de integración activos (SIIGO, JARVIS) de la empresa del JWT.',
  })
  getActiveProviders(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<IntegrationProvidersResponseDto> {
    return this.integrationsService.getActiveProviders(
      getAuthenticatedCompanyId(user),
    );
  }
}
