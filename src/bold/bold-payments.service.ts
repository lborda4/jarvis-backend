import { Injectable, Logger } from '@nestjs/common';
import { BoldHttpClient } from './clients/bold-http.client';
import { BoldPaymentMethodsResponseDto } from './dto/bold-payment-methods.dto';
import { BOLD_PAYMENT_METHODS_MOCK } from './mocks/bold-payment-methods.mock';

@Injectable()
export class BoldPaymentsService {
  private readonly logger = new Logger(BoldPaymentsService.name);

  constructor(private readonly boldHttpClient: BoldHttpClient) {}

  /**
   * Mientras no tengamos credenciales reales de Bold
   * (BOLD_API_KEY/BOLD_API_BASE_URL sin configurar), devuelve el mock que
   * compartió Bold para este endpoint — así el resto del desarrollo
   * (frontend, lógica de negocio) puede avanzar ya mismo contra una forma
   * de respuesta real, y el día que lleguen las credenciales esto empieza
   * a pegarle a la API de verdad sin tocar nada más.
   */
  async getPaymentMethods(): Promise<BoldPaymentMethodsResponseDto> {
    if (!this.boldHttpClient.isConfigured()) {
      this.logger.warn(
        'Bold no está configurado (falta BOLD_API_KEY/BOLD_API_BASE_URL) — devolviendo medios de pago mock.',
      );

      return BOLD_PAYMENT_METHODS_MOCK;
    }

    return this.boldHttpClient.getPaymentMethods();
  }
}
