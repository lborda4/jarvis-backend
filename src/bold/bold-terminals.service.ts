import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BoldHttpClient } from './clients/bold-http.client';
import { BoldBindedTerminalsResponseDto } from './dto/bold-terminals.dto';
import { IntegrationsRepository } from '../integration/repositories/integrations.repository';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import type { BoldCredentials } from '../integration/interfaces/integration-credentials.interface';

@Injectable()
export class BoldTerminalsService {
  constructor(
    private readonly boldHttpClient: BoldHttpClient,
    private readonly integrationsRepository: IntegrationsRepository,
  ) {}

  async getBindedTerminals(
    companyId: string,
  ): Promise<BoldBindedTerminalsResponseDto> {
    if (typeof companyId !== 'string' || !companyId.trim()) {
      throw new BadRequestException('El companyId es obligatorio.');
    }
    const integration =
      await this.integrationsRepository.findByCompanyAndProvider(
        companyId.trim(),
        IntegrationProvider.BOLD,
      );
    if (!integration) {
      throw new NotFoundException(
        'La empresa no tiene una integración Bold activa.',
      );
    }
    const apiKey = (
      integration.credentials as BoldCredentials
    )?.identity_key?.trim();
    if (!apiKey) {
      throw new BadRequestException(
        'Guarde la llave de identidad de Bold para esta empresa.',
      );
    }
    return this.boldHttpClient.getBindedTerminals(apiKey);
  }
}
