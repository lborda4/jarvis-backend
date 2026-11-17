import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfiguration } from '../../config/configuration';
import { isSafeMailFrom } from '../helpers/password-reset.helper';
import { buildPasswordResetEmail } from '../helpers/password-reset-email.helper';
import { buildWelcomeEmail } from '../helpers/welcome-email.helper';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

@Injectable()
export class ResendMailService {
  private readonly logger = new Logger(ResendMailService.name);
  private nextPayrollSendAt = 0;

  constructor(
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  async sendPasswordReset(recipient: string, resetUrl: string): Promise<void> {
    await this.send(recipient, buildPasswordResetEmail(resetUrl));
  }

  async sendWelcome(recipient: string, companyName: string, registrationUrl: string): Promise<boolean> {
    return this.send(recipient, buildWelcomeEmail(companyName, registrationUrl));
  }

  async sendPayrollPayslip(recipient: string, template: { subject: string; html: string; text: string }, attachment: { filename: string; content: string }, requestKey: string): Promise<boolean> {
    const now = Date.now();
    const sendAt = Math.max(now, this.nextPayrollSendAt);
    this.nextPayrollSendAt = sendAt + 250;
    if (sendAt > now) await new Promise(resolve => setTimeout(resolve, sendAt - now));
    return this.send(recipient, template, { attachment, requestKey });
  }

  private async send(recipient: string, template: { subject: string; html: string; text: string }, options?: { attachment: { filename: string; content: string }; requestKey: string }): Promise<boolean> {
    const apiKey = this.configService.get('passwordResetMail.apiKey', {
      infer: true,
    });
    const from = this.configService.get('passwordResetMail.from', {
      infer: true,
    });

    if (!apiKey || !isSafeMailFrom(from)) {
      this.logger.warn(
        'No se envió el correo porque falta la configuración de Resend.',
      );
      return false;
    }

    try {
      const response = await fetch(RESEND_EMAILS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(options ? { 'Idempotency-Key': options.requestKey, 'User-Agent': 'Jarvis/payroll' } : {}),
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          ...template,
          ...(options ? { attachments: [options.attachment] } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });

      await response.text().catch(() => undefined);

      if (!response.ok) {
        this.logger.warn(
          `El proveedor de correo rechazó el envío (${response.status}).`,
        );
      }
      return response.ok;
    } catch {
      this.logger.warn('No se pudo contactar al proveedor de correo.');
      return false;
    }
  }
}
