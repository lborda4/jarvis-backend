import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Integration } from '../entities/integration.entity';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { SiigoCredentials } from '../interfaces/integration-credentials.interface';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SiigoAccountsRepository } from '../repositories/siigo-accounts.repository';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SiigoCredentialsStatusResponseDto } from './dto/siigo-credentials-status.dto';
import {
  SaveSiigoCredentialsRequestDto,
  SaveSiigoCredentialsResponseDto,
} from './dto/save-siigo-credentials.dto';
import {
  normalizeSiigoCredentials,
  resolveSiigoCredentials,
  areSiigoCredentialsConfigured,
  areSiigoDocumentTypesConfigured,
  SiigoEnvCredentials,
} from './helpers/siigo-credentials.helper';
import { isValidSiigoConfigurationId } from './helpers/siigo-document-type.helper';
import {
  formatAuthorizationHeader,
  stripBearerPrefix,
} from './helpers/siigo-auth.helper';
import { handleSiigoApiError } from './helpers/siigo-error.helper';
import { AppConfiguration } from '../../config/configuration';
import { PlanSubscriptionService } from '../../plan/plan-subscription.service';

import { SiigoAuthContext } from './interfaces/siigo-auth-context.interface';

interface CachedAuthContext {
  context: SiigoAuthContext;
  expiresAtMs: number;
}

const TOKEN_SAFETY_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class SiigoAuthService {
  private readonly logger = new Logger(SiigoAuthService.name);
  private readonly sessionAuthContextByCompany = new Map<
    string,
    CachedAuthContext
  >();
  private readonly authContextInProgress = new Map<
    string,
    Promise<SiigoAuthContext>
  >();
  private readonly refreshInProgress = new Map<string, Promise<SiigoCredentials>>();

  constructor(
    private readonly siigoHttpClient: SiigoHttpClient,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly siigoAccountsRepository: SiigoAccountsRepository,
    private readonly planSubscriptionService: PlanSubscriptionService,
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

    this.clearSession(trimmedCompanyId);

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
          active: true,
        }),
      );
    } else {
      const existingCredentials = normalizeSiigoCredentials(
        integration.credentials,
      );
      integration.credentials = {
        username,
        access_key,
        partner_id: partner_id || undefined,
        document_types: existingCredentials.document_types,
      };
    }

    const credentials: SiigoCredentials = {
      username,
      access_key,
      partner_id: partner_id || undefined,
      document_types: normalizeSiigoCredentials(integration.credentials)
        .document_types,
    };

    try {
      const savedCredentials = await this.refreshAndPersistToken(
        integration,
        credentials,
        trimmedCompanyId,
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

  async getCredentialsStatus(
    companyId: string,
  ): Promise<SiigoCredentialsStatusResponseDto> {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    const subscription = await this.planSubscriptionService.getSubscription(
      trimmedCompanyId,
      IntegrationProvider.SIIGO,
    );

    const integration = await this.integrationsRepository.findByCompanyAndProvider(
      trimmedCompanyId,
      IntegrationProvider.SIIGO,
    );

    if (!integration) {
      return {
        configured: false,
        hasAccounts: false,
        documentTypesConfigured: false,
        subscription,
      };
    }

    const credentials = normalizeSiigoCredentials(integration.credentials);
    const configured = areSiigoCredentialsConfigured(integration.credentials);
    const accountsCount =
      await this.siigoAccountsRepository.countByCompanyAndIntegration(
        trimmedCompanyId,
        integration.id,
      );
    const hasAccounts = accountsCount > 0;
    const documentTypesConfigured = areSiigoDocumentTypesConfigured(
      integration.credentials,
      subscription.includedDocumentTypes,
    );
    const supportDocumentTypeId = isValidSiigoConfigurationId(
      credentials.document_types?.support_document_id,
    )
      ? credentials.document_types!.support_document_id!
      : null;
    const purchaseInvoiceTypeId = isValidSiigoConfigurationId(
      credentials.document_types?.purchase_invoice_id,
    )
      ? credentials.document_types!.purchase_invoice_id!
      : null;

    if (!configured) {
      return {
        configured: false,
        hasAccounts,
        documentTypesConfigured: false,
        subscription,
        supportDocumentTypeId,
        purchaseInvoiceTypeId,
      };
    }

    return {
      configured: true,
      hasAccounts,
      documentTypesConfigured,
      subscription,
      username: credentials.username,
      partner_id: credentials.partner_id,
      supportDocumentTypeId,
      purchaseInvoiceTypeId,
    };
  }

  async forceRefreshAuthContext(companyId: string): Promise<SiigoAuthContext> {
    const trimmedCompanyId = companyId.trim();

    this.logger.warn(
      `[companyId=${trimmedCompanyId}] Renovando token SIIGO en sesión tras 401 o expiración.`,
    );

    this.clearSession(trimmedCompanyId);

    const integration = await this.getSiigoIntegration(trimmedCompanyId);
    const credentials = resolveSiigoCredentials(
      normalizeSiigoCredentials(integration.credentials),
      this.getSiigoEnvCredentials(),
    );

    await this.invalidateStoredToken(integration);

    const refreshedCredentials = await this.refreshAndPersistToken(
      integration,
      credentials,
      trimmedCompanyId,
    );

    return this.buildAuthContext(refreshedCredentials, trimmedCompanyId);
  }

  async getValidAuthContext(companyId: string): Promise<SiigoAuthContext> {
    const trimmedCompanyId = companyId.trim();
    const cachedContext = this.getSessionAuthContext(trimmedCompanyId);

    if (cachedContext) {
      return cachedContext;
    }

    const inProgress = this.authContextInProgress.get(trimmedCompanyId);

    if (inProgress) {
      return inProgress;
    }

    const resolvePromise = this.resolveAuthContext(trimmedCompanyId).finally(
      () => {
        this.authContextInProgress.delete(trimmedCompanyId);
      },
    );

    this.authContextInProgress.set(trimmedCompanyId, resolvePromise);

    return resolvePromise;
  }

  private async resolveAuthContext(companyId: string): Promise<SiigoAuthContext> {
    const cachedContext = this.getSessionAuthContext(companyId);

    if (cachedContext) {
      return cachedContext;
    }

    const integration = await this.getSiigoIntegration(companyId);
    const credentials = resolveSiigoCredentials(
      normalizeSiigoCredentials(integration.credentials),
      this.getSiigoEnvCredentials(),
    );

    if (this.isTokenValid(credentials)) {
      const context = this.buildAuthContext(credentials, companyId);

      this.logger.debug(
        `[companyId=${companyId}] Token SIIGO reutilizado desde BD en sesión.`,
      );

      return context;
    }

    this.logger.log(
      `[companyId=${companyId}] Token SIIGO ausente o vencido. Autenticando una sola vez en /auth.`,
    );

    const refreshedCredentials = await this.refreshAndPersistToken(
      integration,
      credentials,
      companyId,
    );

    return this.buildAuthContext(refreshedCredentials, companyId);
  }

  private getSessionAuthContext(companyId: string): SiigoAuthContext | null {
    const cached = this.sessionAuthContextByCompany.get(companyId);

    if (!cached) {
      return null;
    }

    if (cached.expiresAtMs - TOKEN_SAFETY_WINDOW_MS <= Date.now()) {
      this.sessionAuthContextByCompany.delete(companyId);
      return null;
    }

    return cached.context;
  }

  private storeSessionAuthContext(
    companyId: string,
    context: SiigoAuthContext,
    expiresAt?: string,
  ): void {
    const expiresAtMs = expiresAt
      ? new Date(expiresAt).getTime()
      : Date.now() + 60 * 60 * 1000;

    this.sessionAuthContextByCompany.set(companyId, {
      context,
      expiresAtMs,
    });
  }

  private clearSession(companyId: string): void {
    this.sessionAuthContextByCompany.delete(companyId);
    this.authContextInProgress.delete(companyId);
  }

  private buildAuthContext(
    credentials: SiigoCredentials,
    companyId: string,
  ): SiigoAuthContext {
    const context: SiigoAuthContext = {
      accessToken: formatAuthorizationHeader(credentials.token as string),
      partnerId: credentials.partner_id,
    };

    this.storeSessionAuthContext(companyId, context, credentials.expires_at);

    return context;
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

    return expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now();
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
    companyId: string,
  ): Promise<SiigoCredentials> {
    const trimmedCompanyId = companyId.trim();
    const inProgress = this.refreshInProgress.get(trimmedCompanyId);

    if (inProgress) {
      return inProgress;
    }

    const refreshPromise = this.performAuthentication(integration, credentials).finally(
      () => {
        this.refreshInProgress.delete(trimmedCompanyId);
      },
    );

    this.refreshInProgress.set(trimmedCompanyId, refreshPromise);

    return refreshPromise;
  }

  private async performAuthentication(
    integration: Integration,
    credentials: SiigoCredentials,
  ): Promise<SiigoCredentials> {
    const companyId = integration.companyId.trim();

    this.logger.log(`[companyId=${companyId}] POST https://api.siigo.com/auth`, {
      username: credentials.username,
    });

    const authResponse = await this.siigoHttpClient.authenticate({
      username: credentials.username,
      access_key: credentials.access_key,
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

    integration.credentials = updatedCredentials;

    this.buildAuthContext(updatedCredentials, companyId);

    this.logger.log(`[companyId=${companyId}] Token SIIGO almacenado en sesión`, {
      expiresAt: updatedCredentials.expires_at,
    });

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
