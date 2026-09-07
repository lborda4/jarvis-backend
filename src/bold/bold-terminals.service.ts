import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BoldHttpClient } from './clients/bold-http.client';
import { BoldBindedTerminalsResponseDto } from './dto/bold-terminals.dto';
import { BOLD_BINDED_TERMINALS_MOCK } from './mocks/bold-terminals.mock';

@Injectable()
export class BoldTerminalsService {
  private readonly logger = new Logger(BoldTerminalsService.name);

  constructor(private readonly boldHttpClient: BoldHttpClient) {}

  /** `apiKey` viene de la llamada puntual del panel de admin (ver
   * BoldController) — no hay credencial global ni persistida para caer de
   * respaldo. Mientras Bold no esté configurado de verdad
   * (BOLD_API_KEY/BOLD_API_BASE_URL, ver BoldHttpClient.isConfigured)
   * devuelve el mock que compartió Bold para este endpoint, igual que
   * BoldPaymentsService.getPaymentMethods — así se puede probar el flujo de
   * crear una caja y vincularle un datáfono sin credenciales reales todavía. */
  async getBindedTerminals(
    apiKey?: string,
  ): Promise<BoldBindedTerminalsResponseDto> {
    if (!this.boldHttpClient.isConfigured()) {
      this.logger.warn(
        'Bold no está configurado (falta BOLD_API_KEY/BOLD_API_BASE_URL) — devolviendo datáfonos mock.',
      );

      return BOLD_BINDED_TERMINALS_MOCK;
    }

    const trimmedApiKey = apiKey?.trim();

    if (!trimmedApiKey) {
      throw new BadRequestException(
        'Falta la llave de identidad (x-api-key) de Bold para esta empresa.',
      );
    }

    return this.boldHttpClient.getBindedTerminals(trimmedApiKey);
  }
}
