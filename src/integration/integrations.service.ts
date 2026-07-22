import { BadRequestException, Injectable } from '@nestjs/common';
import { IntegrationProvidersResponseDto } from './dto/integration-providers.dto';
import { IntegrationsRepository } from './repositories/integrations.repository';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly integrationsRepository: IntegrationsRepository,
  ) {}

  async getActiveProviders(
    companyId: string,
  ): Promise<IntegrationProvidersResponseDto> {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    const integrations =
      await this.integrationsRepository.findAllByCompanyId(trimmedCompanyId);

    return {
      providers: integrations.map((integration) => integration.provider),
    };
  }
}
