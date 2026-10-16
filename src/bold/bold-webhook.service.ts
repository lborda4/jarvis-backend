import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfiguration } from '../config/configuration';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import type { BoldCredentials } from '../integration/interfaces/integration-credentials.interface';
import { IntegrationsRepository } from '../integration/repositories/integrations.repository';
import {
  hashBoldWebhookRawBody,
  isBoldWebhookSignatureValid,
  readBoldSignatureHeader,
} from './helpers/bold-webhook-signature.helper';
import type { BoldWebhookNotification } from './interfaces/bold-webhook-notification.interface';
import { BoldWebhookEventsRepository } from './repositories/bold-webhook-events.repository';

export type BoldWebhookEnvironment = 'production' | 'test';

export interface ReceiveBoldWebhookInput {
  rawBody: Buffer | string | undefined;
  signature: string | string[] | undefined;
  body: unknown;
}

@Injectable()
export class BoldWebhookService {
  private readonly logger = new Logger(BoldWebhookService.name);

  constructor(
    private readonly events: BoldWebhookEventsRepository,
    private readonly integrations: IntegrationsRepository,
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  /** Webhook de producción: firma HMAC con la llave secreta de la empresa. */
  receiveProduction(input: ReceiveBoldWebhookInput) {
    return this.receive(input, 'production');
  }

  /**
   * Webhook de pruebas de Bold: la firma usa llave vacía.
   * https://developers.bold.co/webhook
   */
  receiveTest(input: ReceiveBoldWebhookInput) {
    return this.receive(input, 'test');
  }

  private async receive(
    input: ReceiveBoldWebhookInput,
    environment: BoldWebhookEnvironment,
  ): Promise<{ received: true }> {
    const rawBody = input.rawBody;
    const signature = readBoldSignatureHeader(input.signature);
    if (!rawBody || rawBody.length === 0 || !signature) {
      this.logInvalidSignature(rawBody, signature, environment, 'missing_body_or_signature');
      throw new UnauthorizedException(
        'No se pudo verificar el origen de la notificación.',
      );
    }

    const companyId = await this.companyIdForValidSignature(
      rawBody,
      signature,
      environment,
    );
    if (companyId === undefined) {
      throw new UnauthorizedException(
        'No se pudo verificar el origen de la notificación.',
      );
    }

    const notification = this.parseNotification(input.body, rawBody);
    const paymentId = notification.data?.payment_id?.trim() || null;
    const reference = notification.data?.metadata?.reference?.trim() || null;
    const type = notification.type?.trim() || 'UNKNOWN';
    const notificationId = this.notificationId(notification, rawBody, environment);
    const amountTotal = notification.data?.amount?.total;
    const outcome = await this.events.insertIfNew({
      notificationId,
      companyId,
      environment,
      type,
      paymentId,
      reference,
      merchantId: notification.data?.merchant_id?.trim() || null,
      amountTotal:
        typeof amountTotal === 'number' && Number.isFinite(amountTotal)
          ? amountTotal.toFixed(2)
          : null,
      amountCurrency: notification.data?.amount?.currency?.trim() || null,
      payload: notification,
    });

    this.logger.log(
      [
        environment,
        outcome === 'duplicate' ? 'duplicado' : 'recibido',
        type,
        `payment=${paymentId ?? '-'}`,
        `reference=${reference ?? '-'}`,
        `company=${companyId ?? '-'}`,
      ].join(' '),
    );

    return { received: true };
  }

  /** `undefined` = firma inválida; `null` = válida pero sin empresa. */
  private async companyIdForValidSignature(
    rawBody: Buffer | string,
    signature: string,
    environment: BoldWebhookEnvironment,
  ): Promise<string | null | undefined> {
    const integrations = await this.integrations.findAllActiveByProvider(
      IntegrationProvider.BOLD,
    );

    const matchesTestKey = isBoldWebhookSignatureValid(rawBody, '', signature);
    if (environment === 'test' && matchesTestKey) {
      return integrations[0]?.companyId ?? null;
    }

    let configuredCompanySecrets = 0;
    let matchesCompanySecret = false;
    for (const integration of integrations) {
      const secret = (integration.credentials as BoldCredentials | undefined)
        ?.secret_key?.trim();
      if (!secret) continue;
      configuredCompanySecrets += 1;
      if (isBoldWebhookSignatureValid(rawBody, secret, signature)) {
        if (environment === 'production') return integration.companyId;
        matchesCompanySecret = true;
      }
    }

    const envSecret = this.configService.get('bold', { infer: true }).key;
    const matchesEnvSecret = Boolean(envSecret &&
      isBoldWebhookSignatureValid(rawBody, envSecret, signature));
    if (environment === 'production' && matchesEnvSecret) {
      return integrations[0]?.companyId ?? null;
    }

    this.logInvalidSignature(rawBody, signature, environment, 'hmac_mismatch', {
      activeIntegrations: integrations.length,
      configuredCompanySecrets,
      envSecretConfigured: Boolean(envSecret),
      matchesTestKey,
      matchesCompanySecret,
      matchesEnvSecret,
    });
    return undefined;
  }

  private logInvalidSignature(
    rawBody: Buffer | string | undefined,
    signature: string,
    environment: BoldWebhookEnvironment,
    reason: string,
    checks: Record<string, number | boolean> = {},
  ): void {
    // Only diagnostic metadata: never log the payload, keys or signature values.
    this.logger.warn(`Webhook Bold ${environment} con firma inválida ${JSON.stringify({
      reason,
      rawBodyPresent: rawBody !== undefined,
      rawBodyBytes: rawBody === undefined ? 0 : Buffer.byteLength(rawBody),
      signatureLength: signature.length,
      signatureIsHex64: /^[a-f0-9]{64}$/.test(signature),
      ...checks,
    })}`);
  }

  private notificationId(
    notification: BoldWebhookNotification,
    rawBody: Buffer | string,
    environment: BoldWebhookEnvironment,
  ): string {
    const id =
      notification.id?.trim() || `sha256:${hashBoldWebhookRawBody(rawBody)}`;
    return environment === 'test' ? `test:${id}` : id;
  }

  private parseNotification(
    body: unknown,
    rawBody: Buffer | string,
  ): BoldWebhookNotification {
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      return body as BoldWebhookNotification;
    }
    try {
      const text = Buffer.isBuffer(rawBody)
        ? rawBody.toString('utf8')
        : rawBody;
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        return parsed as BoldWebhookNotification;
      }
    } catch {
      this.logger.warn('Webhook Bold con cuerpo JSON inválido');
    }
    return {};
  }
}
