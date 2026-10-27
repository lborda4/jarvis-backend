import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfiguration } from '../../config/configuration';
import { isSafeMailFrom } from '../helpers/password-reset.helper';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@Injectable()
export class ResendMailService {
  private readonly logger = new Logger(ResendMailService.name);

  constructor(
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  async sendPasswordReset(recipient: string, resetUrl: string): Promise<void> {
    const apiKey = this.configService.get('passwordResetMail.apiKey', {
      infer: true,
    });
    const from = this.configService.get('passwordResetMail.from', {
      infer: true,
    });

    if (!apiKey || !isSafeMailFrom(from)) {
      this.logger.warn(
        'No se envió el correo de restablecimiento porque falta la configuración de Resend.',
      );
      return;
    }

    const safeUrl = escapeHtml(resetUrl);

    try {
      const response = await fetch(RESEND_EMAILS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          subject: 'Restablece tu contraseña en Jarvis',
          html: `<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en Jarvis.</p><p><a href="${safeUrl}">Restablecer contraseña</a></p><p>El enlace vence en 45 minutos. Si no fuiste tú, ignora este correo.</p>`,
          text: `Recibimos una solicitud para restablecer la contraseña de tu cuenta en Jarvis.\n\n${resetUrl}\n\nEl enlace vence en 45 minutos. Si no fuiste tú, ignora este correo.`,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      await response.text().catch(() => undefined);

      if (!response.ok) {
        this.logger.warn(
          `El proveedor de correo rechazó el envío (${response.status}).`,
        );
      }
    } catch {
      this.logger.warn('No se pudo contactar al proveedor de correo.');
    }
  }
}
