import { BadRequestException, Injectable } from '@nestjs/common';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { JarvisCredentials } from '../interfaces/integration-credentials.interface';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { JarvisEntityType } from './enums/jarvis-entity-type.enum';
import { JarvisTaxRegime } from './enums/jarvis-tax-regime.enum';
import { JarvisCredentialsStatusResponseDto } from './dto/jarvis-credentials-status.dto';
import {
  SaveJarvisCredentialsRequestDto,
  SaveJarvisCredentialsResponseDto,
} from './dto/save-jarvis-credentials.dto';
import {
  areJarvisCredentialsConfigured,
  normalizeJarvisCredentials,
} from './helpers/jarvis-credentials.helper';

const VALID_ENTITY_TYPES = new Set<string>(Object.values(JarvisEntityType));
const VALID_TAX_REGIMES = new Set<string>(Object.values(JarvisTaxRegime));

@Injectable()
export class JarvisSetupService {
  constructor(
    private readonly integrationsRepository: IntegrationsRepository,
  ) {}

  async saveCredentials(
    request: SaveJarvisCredentialsRequestDto,
    companyId: string,
  ): Promise<SaveJarvisCredentialsResponseDto> {
    const trimmedCompanyId = companyId?.trim();
    const business_name = request.business_name?.trim();
    const economic_activity = request.economic_activity?.trim();
    const entity_type = request.entity_type;
    const tax_regime = request.tax_regime;

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    if (!business_name) {
      throw new BadRequestException('La razón social es obligatoria.');
    }

    if (!economic_activity) {
      throw new BadRequestException('La actividad económica es obligatoria.');
    }

    if (!entity_type || !VALID_ENTITY_TYPES.has(entity_type)) {
      throw new BadRequestException(
        'Debe indicar si el contribuyente es persona natural o jurídica.',
      );
    }

    if (!tax_regime || !VALID_TAX_REGIMES.has(tax_regime)) {
      throw new BadRequestException('Debe seleccionar un tipo de régimen válido.');
    }

    const configured_at = new Date().toISOString();
    const credentials: JarvisCredentials = {
      business_name,
      economic_activity,
      entity_type,
      tax_regime,
      configured_at,
    };

    let integration = await this.integrationsRepository.findByCompanyAndProvider(
      trimmedCompanyId,
      IntegrationProvider.JARVIS,
    );

    if (!integration) {
      integration = await this.integrationsRepository.save(
        this.integrationsRepository.create({
          companyId: trimmedCompanyId,
          provider: IntegrationProvider.JARVIS,
          credentials,
          active: true,
        }),
      );
    } else {
      integration.credentials = credentials;
      integration = await this.integrationsRepository.save(integration);
    }

    return {
      success: true,
      business_name,
      configured_at,
    };
  }

  async getCredentialsStatus(
    companyId: string,
  ): Promise<JarvisCredentialsStatusResponseDto> {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    const integration = await this.integrationsRepository.findByCompanyAndProvider(
      trimmedCompanyId,
      IntegrationProvider.JARVIS,
    );

    if (!integration) {
      return { configured: false };
    }

    const credentials = normalizeJarvisCredentials(integration.credentials);
    const configured = areJarvisCredentialsConfigured(integration.credentials);

    if (!configured) {
      return { configured: false };
    }

    return {
      configured: true,
      business_name: credentials.business_name,
      economic_activity: credentials.economic_activity,
      entity_type: credentials.entity_type,
      tax_regime: credentials.tax_regime,
      configured_at: credentials.configured_at,
    };
  }
}
