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

  /**
   * Recibe el POST de Bold, verifica HMAC, persiste (idempotente) y
   * responde 200. No dispara facturación ni SIIGO: solo deja constancia
   * del cobro para el siguiente paso.
   */
  async receive(input: ReceiveBoldWebhookInput): Promise<{ received: true }> {
    const rawBody = input.rawBody;
    const signature = readBoldSignatureHeader(input.signature);
    if (!rawBody || rawBody.length === 0 || !signature) {
      throw new UnauthorizedException(
        'No se pudo verificar el origen de la notificación.',
      );
    }

    const companyId = await this.companyIdForValidSignature(rawBody, signature);
    if (companyId === undefined) {
      this.logger.warn('Webhook Bold con firma inválida');
      throw new UnauthorizedException(
        'No se pudo verificar el origen de la notificación.',
      );
    }

    const notification = this.parseNotification(input.body, rawBody);
    const paymentId = notification.data?.payment_id?.trim() || null;
    const reference = notification.data?.metadata?.reference?.trim() || null;
    const type = notification.type?.trim() || 'UNKNOWN';
    const notificationId =
      notification.id?.trim() || `sha256:${hashBoldWebhookRawBody(rawBody)}`;
    const amountTotal = notification.data?.amount?.total;
    const outcome = await this.events.insertIfNew({
      notificationId,
      companyId,
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
  ): Promise<string | null | undefined> {
    const integrations = await this.integrations.findAllActiveByProvider(
      IntegrationProvider.BOLD,
    );
    for (const integration of integrations) {
      const secret = (integration.credentials as BoldCredentials | undefined)
        ?.secret_key?.trim();
      if (!secret) continue;
      if (isBoldWebhookSignatureValid(rawBody, secret, signature)) {
        return integration.companyId;
      }
    }

    const envSecret = this.configService.get('bold', { infer: true }).key;
    if (
      envSecret &&
      isBoldWebhookSignatureValid(rawBody, envSecret, signature)
    ) {
      return integrations[0]?.companyId ?? null;
    }

    const nodeEnv = this.configService.get('app.nodeEnv', { infer: true });
    if (
      nodeEnv !== 'production' &&
      isBoldWebhookSignatureValid(rawBody, '', signature)
    ) {
      return integrations[0]?.companyId ?? null;
    }

    return undefined;
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
