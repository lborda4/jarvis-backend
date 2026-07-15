import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Integration } from '../entities/integration.entity';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { SiigoCredentials } from '../interfaces/integration-credentials.interface';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SiigoHttpClient } from './clients/siigo-http.client';
import {
  SaveSiigoCredentialsRequestDto,
  SaveSiigoCredentialsResponseDto,
} from './dto/save-siigo-credentials.dto';
import {
  normalizeSiigoCredentials,
  resolveSiigoCredentials,
  SiigoEnvCredentials,
} from './helpers/siigo-credentials.helper';
import {
  formatAuthorizationHeader,
  stripBearerPrefix,
} from './helpers/siigo-auth.helper';
import { handleSiigoApiError } from './helpers/siigo-error.helper';
import { AppConfiguration } from '../../config/configuration';

import { SiigoAuthContext } from './interfaces/siigo-auth-context.interface';

interface CachedAuthContext {
  context: SiigoAuthContext;
  expiresAtMs: number;
}

@Injectable()
export class SiigoAuthService {
  private readonly logger = new Logger(SiigoAuthService.name);
  private readonly authContextCache = new Map<string, CachedAuthContext>();

  constructor(
    private readonly siigoHttpClient: SiigoHttpClient,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  async getValidAccessToken(companyId: string): Promise<string> {
    const context = await this.getValidAuthContext(companyId);
    return context.accessToken;
  }

  async saveCredentials(
    request: SaveSiigoCredentialsRequestDto,
    companyId: string,
  ): Promise<SaveSiigoCredentialsResponseDto> {
    const trimmedCompanyId = companyId?.trim();
    const username = request.username?.trim();
    const access_key = request.access_key?.trim();
    const partner_id = request.partner_id?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    if (!username) {
      throw new BadRequestException('El campo username es obligatorio.');
    }

    if (!access_key) {
      throw new BadRequestException('El campo access_key es obligatorio.');
    }

    let integration = await this.integrationsRepository.findByCompanyAndProvider(
      trimmedCompanyId,
      IntegrationProvider.SIIGO,
    );

    if (!integration) {
      integration = await this.integrationsRepository.save(
        this.integrationsRepository.create({
          companyId: trimmedCompanyId,
          provider: IntegrationProvider.SIIGO,
          credentials: {
            username,
            access_key,
            partner_id: partner_id || undefined,
          },
          configuration: {},
          active: true,
        }),
      );
    }

    const credentials: SiigoCredentials = {
      username,
      access_key,
      partner_id: partner_id || undefined,
    };

    try {
      const savedCredentials = await this.refreshAndPersistToken(
        integration,
        credentials,
      );

      this.logger.log(
        `[companyId=${trimmedCompanyId}] Credenciales SIIGO guardadas`,
        {
          integrationId: integration.id,
          username: savedCredentials.username,
          partner_id: savedCredentials.partner_id,
          expires_at: savedCredentials.expires_at,
        },
      );

      return {
        success: true,
        username: savedCredentials.username,
        partner_id: savedCredentials.partner_id,
        expires_at: savedCredentials.expires_at as string,
      };
    } catch (error) {
      handleSiigoApiError(
        this.logger,
        error,
        'guardar credenciales y autenticar',
      );
    }
  }

  async forceRefreshAuthContext(companyId: string): Promise<SiigoAuthContext> {
    console.log('[SIIGO auth] forzando renovación de token...', { companyId });

    this.authContextCache.delete(companyId.trim());

    const integration = await this.getSiigoIntegration(companyId);
    const credentials = resolveSiigoCredentials(
      normalizeSiigoCredentials(integration.credentials),
      this.getSiigoEnvCredentials(),
    );
    await this.invalidateStoredToken(integration);
    const refreshedCredentials = await this.refreshAndPersistToken(
      integration,
      credentials,
    );

    console.log('[SIIGO auth] token forzado OK', {
      companyId,
      expiresAt: refreshedCredentials.expires_at,
    });

    const context = {
      accessToken: formatAuthorizationHeader(refreshedCredentials.token as string),
      partnerId: refreshedCredentials.partner_id,
    };

    this.cacheAuthContext(companyId.trim(), context, refreshedCredentials.expires_at);

    return context;
  }

  async getValidAuthContext(companyId: string): Promise<SiigoAuthContext> {
    const trimmedCompanyId = companyId.trim();
    const cached = this.authContextCache.get(trimmedCompanyId);
    const safetyWindowMs = 5 * 60 * 1000;

    if (cached && cached.expiresAtMs - safetyWindowMs > Date.now()) {
      return cached.context;
    }

    console.log('[SIIGO auth] obteniendo contexto de autenticación...', {
      companyId: trimmedCompanyId,
    });

    const integration = await this.getSiigoIntegration(trimmedCompanyId);
    const credentials = resolveSiigoCredentials(
      normalizeSiigoCredentials(integration.credentials),
      this.getSiigoEnvCredentials(),
    );

    let context: SiigoAuthContext;
    let expiresAt = credentials.expires_at;

    if (this.isTokenValid(credentials)) {
      console.log('[SIIGO auth] token en caché válido', {
        companyId: trimmedCompanyId,
        expiresAt: credentials.expires_at,
        hasPartnerId: Boolean(credentials.partner_id),
      });

      context = {
        accessToken: formatAuthorizationHeader(credentials.token as string),
        partnerId: credentials.partner_id,
      };
    } else {
      console.log('[SIIGO auth] token expirado o inexistente, renovando...', {
        companyId: trimmedCompanyId,
      });

      const refreshedCredentials = await this.refreshAndPersistToken(
        integration,
        credentials,
      );

      console.log('[SIIGO auth] token renovado OK', {
        companyId: trimmedCompanyId,
        expiresAt: refreshedCredentials.expires_at,
        hasPartnerId: Boolean(refreshedCredentials.partner_id),
      });

      expiresAt = refreshedCredentials.expires_at;
      context = {
        accessToken: formatAuthorizationHeader(refreshedCredentials.token as string),
        partnerId: refreshedCredentials.partner_id,
      };
    }

    this.cacheAuthContext(trimmedCompanyId, context, expiresAt);

    return context;
  }

  private cacheAuthContext(
    companyId: string,
    context: SiigoAuthContext,
    expiresAt?: string,
  ): void {
    const expiresAtMs = expiresAt
      ? new Date(expiresAt).getTime()
      : Date.now() + 60 * 60 * 1000;

    this.authContextCache.set(companyId, {
      context,
      expiresAtMs,
    });
  }

  private async getSiigoIntegration(companyId: string): Promise<Integration> {
    const integration = await this.integrationsRepository.findByCompanyAndProvider(
      companyId,
      IntegrationProvider.SIIGO,
    );

    if (!integration) {
      throw new BadRequestException(
        'No existe una integración SIIGO configurada para esta empresa. Guarde las credenciales en POST /integrations/siigo/credentials.',
      );
    }

    return integration;
  }

  private isTokenValid(credentials: SiigoCredentials): boolean {
    if (!credentials.token || !credentials.expires_at) {
      return false;
    }

    const expiresAt = new Date(credentials.expires_at).getTime();
    const now = Date.now();
    const safetyWindowMs = 5 * 60 * 1000;

    return expiresAt - safetyWindowMs > now;
  }

  private async invalidateStoredToken(integration: Integration): Promise<void> {
    const credentials = normalizeSiigoCredentials(integration.credentials);

    await this.integrationsRepository.updateCredentials(integration, {
      ...credentials,
      token: undefined,
      expires_at: undefined,
    });
  }

  private async refreshAndPersistToken(
    integration: Integration,
    credentials: SiigoCredentials,
  ): Promise<SiigoCredentials> {
    console.log('[SIIGO auth] ANTES authenticate', {
      companyId: integration.companyId,
      username: credentials.username,
      hasAccessKey: Boolean(credentials.access_key),
      hasPartnerId: Boolean(credentials.partner_id),
    });

    const authResponse = await this.siigoHttpClient.authenticate({
      username: credentials.username,
      access_key: credentials.access_key,
    });

    console.log('[SIIGO auth] DESPUÉS authenticate OK', {
      companyId: integration.companyId,
      expiresIn: authResponse.expires_in,
    });

    const updatedCredentials: SiigoCredentials = {
      ...credentials,
      token: stripBearerPrefix(authResponse.access_token),
      expires_at: new Date(
        Date.now() + authResponse.expires_in * 1000,
      ).toISOString(),
    };

    await this.integrationsRepository.updateCredentials(
      integration,
      updatedCredentials,
    );

    return updatedCredentials;
  }

  private getSiigoEnvCredentials(): SiigoEnvCredentials {
    return {
      username: this.configService.get('siigo.username', { infer: true }),
      accessKey: this.configService.get('siigo.accessKey', { infer: true }),
      partnerId: this.configService.get('siigo.partnerId', { infer: true }),
    };
  }
}
