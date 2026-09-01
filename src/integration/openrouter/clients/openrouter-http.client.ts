import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppConfiguration } from '../../../config/configuration';

export interface OpenRouterMessage {
  role: 'system' | 'user';
  content: string;
}

const LOG_PREVIEW_LIMIT = 2000;
/** Tope por defecto de tokens de salida — las respuestas que pedimos son
 * siempre un JSON chico (2-3 campos, probado con openai/gpt-4o-mini en
 * ~15-20 tokens reales), así que un modelo que se desvía de la instrucción
 * de "solo el JSON" igual corta corto en vez de generar texto largo y caro.
 * (Con el auto-router gratuito "openrouter/free" hacía falta un tope mucho
 * más alto porque algunos backends gastaban el presupuesto en un
 * `reasoning` oculto antes de responder — eso ya no aplica con un modelo
 * fijo como este, que no hace ese razonamiento oculto.)
 */
const DEFAULT_MAX_TOKENS = 100;

/**
 * Reemplaza la integración anterior con OpenAI directo — mismo formato
 * OpenAI-compatible (chat/completions), pero a través de OpenRouter, que
 * permite enrutar a distintos modelos con una sola API key/endpoint.
 */
@Injectable()
export class OpenRouterHttpClient {
  private readonly logger = new Logger(OpenRouterHttpClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get('openRouter.apiKey', { infer: true }),
    );
  }

  async createChatCompletion(
    messages: OpenRouterMessage[],
    options: { maxTokens?: number } = {},
  ): Promise<string> {
    const config = this.configService.get('openRouter', { infer: true });

    if (!config.apiKey) {
      throw new BadGatewayException(
        'La integración con IA no está configurada (falta OPENROUTER_API_KEY).',
      );
    }

    const requestBody = {
      model: config.model,
      messages,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      // Fuerza una respuesta JSON válida en vez de confiar solo en la
      // instrucción del prompt — la mayoría de los modelos servidos por
      // OpenRouter (incluido openai/*) soportan este campo.
      response_format: { type: 'json_object' },
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(
          `${config.baseUrl}/chat/completions`,
          requestBody,
          {
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
            validateStatus: () => true,
          },
        ),
      );

      if (response.status < 200 || response.status >= 300) {
        this.logger.error(
          `[OpenRouter] POST /chat/completions respondió con estado ${response.status}: ${this.preview(
            response.data,
          )}`,
        );
        throw new BadGatewayException(
          'No se pudo obtener la sugerencia de IA (error de OpenRouter).',
        );
      }

      return this.extractMessageContent(response.data);
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      this.logger.error(
        `[OpenRouter] Error al llamar a /chat/completions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      throw new BadGatewayException(
        'No se pudo obtener la sugerencia de IA. Intenta nuevamente.',
      );
    }
  }

  private extractMessageContent(data: unknown): string {
    if (!data || typeof data !== 'object') {
      return '';
    }

    const choices = (data as Record<string, unknown>).choices;

    if (!Array.isArray(choices) || choices.length === 0) {
      return '';
    }

    const message = (choices[0] as Record<string, unknown>)?.message;
    const content =
      message && typeof message === 'object'
        ? (message as Record<string, unknown>).content
        : undefined;

    return typeof content === 'string' ? content : '';
  }

  private preview(value: unknown): string {
    let serialized: string;

    try {
      serialized = JSON.stringify(value) ?? String(value);
    } catch {
      return '[no serializable]';
    }

    return serialized.length > LOG_PREVIEW_LIMIT
      ? `${serialized.slice(0, LOG_PREVIEW_LIMIT)}... (${serialized.length} chars)`
      : serialized;
  }
}
