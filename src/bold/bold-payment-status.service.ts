import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { AppConfiguration } from '../config/configuration';
import { BoldWebhookEventsRepository } from './repositories/bold-webhook-events.repository';

interface StatusClaims {
  companyId: string;
  reference: string;
  amount: number;
  expires: number;
}

@Injectable()
export class BoldPaymentStatusService {
  constructor(
    private readonly events: BoldWebhookEventsRepository,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}

  // Capability limitada a una operación; no expone estados de otras empresas.
  issue(companyId: string, reference: string, amount: number): string {
    const claims: StatusClaims = { companyId, reference, amount, expires: Date.now() + 30 * 60_000 };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${body}.${this.sign(body).toString('base64url')}`;
  }

  private sign(body: string): Buffer {
    const key = this.config.get('jwt', { infer: true }).accessSecret;
    if (!key) throw new UnauthorizedException('Consulta de pago no disponible.');
    return createHmac('sha256', key).update(`bold-payment-status:${body}`).digest();
  }

  async getStatus(token: string) {
    let claims: StatusClaims;
    try {
      if (typeof token !== 'string' || token.length > 2048) throw new Error();
      const [body, signature, extra] = token.split('.');
      if (!body || !signature || extra !== undefined) throw new Error();
      const expected = this.sign(body);
      const supplied = Buffer.from(signature, 'base64url');
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error();
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatusClaims;
      if (!claims.companyId || !claims.reference || !Number.isFinite(claims.amount) ||
          !Number.isFinite(claims.expires) || claims.expires <= Date.now()) throw new Error();
    } catch {
      throw new UnauthorizedException('Consulta de pago invalida o vencida.');
    }
    const events = await this.events.findProductionByReference(claims.companyId, claims.reference);
    // Solo eventos firmados de producción y el importe exacto de esta solicitud.
    const relevant = events.filter(event => event.paymentId && event.amountTotal !== null &&
      Number(event.amountTotal) === claims.amount &&
      (!event.amountCurrency || event.amountCurrency === 'COP'));
    const voided = new Set(relevant.filter(e => e.type === 'VOID_APPROVED').map(e => e.paymentId));
    const approved = relevant.find(e => e.type === 'SALE_APPROVED' && !voided.has(e.paymentId));
    const status = approved ? 'APPROVED' : voided.size ? 'VOIDED'
      : relevant.some(e => e.type === 'SALE_REJECTED') ? 'REJECTED' : 'PENDING';
    return { reference: claims.reference, status };
  }
}
