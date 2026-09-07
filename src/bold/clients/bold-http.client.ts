import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppConfiguration } from '../../config/configuration';
import { BoldPaymentMethodsResponseDto } from '../dto/bold-payment-methods.dto';
import { BoldBindedTerminalsResponseDto } from '../dto/bold-terminals.dto';

const BOLD_HTTP_TIMEOUT_MS = 15_000;

@Injectable()
export class BoldHttpClient {
  private readonly logger = new Logger(BoldHttpClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  /** true solo cuando hay API key Y base URL configuradas — mientras Bold
   * no nos dé credenciales, los llamadores (BoldPaymentsService) usan esto
   * para caer al mock en vez de intentar una llamada real. */
  isConfigured(): boolean {
    const config = this.configService.get('bold', { infer: true });

    return Boolean(config.apiKey) && Boolean(config.baseUrl);
  }

  async getPaymentMethods(): Promise<BoldPaymentMethodsResponseDto> {
    const config = this.configService.get('bold', { infer: true });

    if (!config.apiKey || !config.baseUrl) {
      throw new BadGatewayException(
        'La integración con Bold no está configurada (falta BOLD_API_KEY o BOLD_API_BASE_URL).',
      );
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<BoldPaymentMethodsResponseDto>(
          `${config.baseUrl}/payments/payment-methods`,
          {
            headers: {
              // Tal cual la pasó Bold: el valor del header Authorization
              // es literalmente "x-api-key <llave>", no un header aparte.
              Authorization: `x-api-key ${config.apiKey}`,
            },
            timeout: BOLD_HTTP_TIMEOUT_MS,
            validateStatus: () => true,
          },
        ),
      );

      if (response.status < 200 || response.status >= 300) {
        this.logger.error(
          `[Bold] GET /payments/payment-methods respondió con estado ${response.status}: ${JSON.stringify(response.data)}`,
        );
        throw new BadGatewayException(
          `Bold respondió con estado ${response.status} al consultar los medios de pago.`,
        );
      }

      return response.data;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      this.logger.error(
        `[Bold] Error al consultar /payments/payment-methods: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      throw new BadGatewayException(
        'No se pudo consultar los medios de pago de Bold.',
      );
    }
  }

  /**
   * A diferencia de getPaymentMethods, la llave (`apiKey`) NO sale de la
   * configuración global — cada empresa tiene su propia cuenta Bold, y por
   * ahora el admin la ingresa a mano en el panel en vez de guardarla en BD
   * (ver ensureBoldIntegration). `baseUrl` sí sigue siendo global: es la
   * misma API de Bold para todas las empresas, solo cambia la llave.
   */
  async getBindedTerminals(
    apiKey: string,
  ): Promise<BoldBindedTerminalsResponseDto> {
    const config = this.configService.get('bold', { infer: true });

    if (!config.baseUrl) {
      throw new BadGatewayException(
        'La integración con Bold no está configurada (falta BOLD_API_BASE_URL).',
      );
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<BoldBindedTerminalsResponseDto>(
          `${config.baseUrl}/payments/binded-terminals`,
          {
            headers: {
              Authorization: `x-api-key ${apiKey}`,
            },
            timeout: BOLD_HTTP_TIMEOUT_MS,
            validateStatus: () => true,
          },
        ),
      );

      if (response.status < 200 || response.status >= 300) {
        this.logger.error(
          `[Bold] GET /payments/binded-terminals respondió con estado ${response.status}: ${JSON.stringify(response.data)}`,
        );
        throw new BadGatewayException(
          `Bold respondió con estado ${response.status} al consultar los datáfonos.`,
        );
      }

      return response.data;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      this.logger.error(
        `[Bold] Error al consultar /payments/binded-terminals: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      throw new BadGatewayException(
        'No se pudo consultar los datáfonos de Bold.',
      );
    }
  }
}
