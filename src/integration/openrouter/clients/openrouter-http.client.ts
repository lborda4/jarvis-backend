import { randomUUID } from 'crypto';
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppConfiguration } from '../../../config/configuration';
import { AiGenerationLogsRepository } from '../repositories/ai-generation-logs.repository';

export interface OpenRouterMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * Contexto de trazabilidad de una llamada — ver AiGenerationLog. `purpose`
 * identifica qué llamador disparó la generación (ej.
 * 'purchase-item-classification' vs 'purchase-full-classification'), ambos
 * distintos consumidores del mismo cliente. `aiRequestId` es opcional: si el
 * llamador ya generó uno (para loguear "iniciando..." antes de llamar acá),
 * se reutiliza; si no, este cliente genera uno.
 */
export interface OpenRouterCallContext {
  aiRequestId?: string;
  companyId?: string;
  documentId?: string;
  purpose: string;
}

export interface OpenRouterCompletionResult {
  content: string;
  aiRequestId: string;
}

const LOG_PREVIEW_LIMIT = 2000;
/** Tope por defecto de tokens de salida — las respuestas que pedimos son
 * siempre un JSON chico (2-3 campos, probado con openai/gpt-4o-mini en
 * ~15-20 tokens reales), así que un modelo que se desvía de la instrucción
 * de "solo el JSON" igual corta corto en vez de generar texto largo y caro.
 * (Con el auto-router gratuito "openrouter/free"/"openrouter/auto" hace
 * falta un tope más alto porque algunos backends gastan el presupuesto en un
 * `reasoning` oculto antes de responder — ver reasoningTokens en
 * AiGenerationLog, que existe justamente para detectar esto por llamada en
 * vez de adivinarlo.)
 */
const DEFAULT_MAX_TOKENS = 100;

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

interface OpenRouterCompletionResponse {
  id?: string;
  model?: string;
  usage?: OpenRouterUsage;
  choices?: Array<{
    finish_reason?: string;
    native_finish_reason?: string;
    message?: { content?: string };
  }>;
}

interface OpenRouterGenerationStats {
  request_id?: string;
  provider_name?: string;
  total_cost?: number;
  native_finish_reason?: string;
  generation_time?: number;
  latency?: number;
}

/**
 * Reemplaza la integración anterior con OpenAI directo — mismo formato
 * OpenAI-compatible (chat/completions), pero a través de OpenRouter, que
 * permite enrutar a distintos modelos con una sola API key/endpoint.
 *
 * Trazabilidad (ver AiGenerationLog): cada llamada genera/recibe un
 * `aiRequestId` propio (nuestro, no garantizado por OpenRouter) que
 * correlaciona los logs `[AI]` de principio a fin y la fila de auditoría en
 * `ai_generation_logs`. El `id` que devuelve OpenRouter en el completion ES
 * su generation id — la forma oficial de conseguir el resto de metadata
 * (proveedor real, costo definitivo, latencia) es una consulta aparte a
 * GET /generation?id=..., que se hace en segundo plano después de responder
 * (ver fetchGenerationStats) para no retrasar al llamador esperándola.
 */
@Injectable()
export class OpenRouterHttpClient {
  private readonly logger = new Logger(OpenRouterHttpClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<AppConfiguration, true>,
    private readonly aiGenerationLogsRepository: AiGenerationLogsRepository,
  ) {}

  isConfigured(): boolean {
    const config = this.configService.get('openRouter', { infer: true });

    return Boolean(config.apiKey) && config.enabled;
  }

  async createChatCompletion(
    messages: OpenRouterMessage[],
    options: { maxTokens?: number; context: OpenRouterCallContext },
  ): Promise<OpenRouterCompletionResult> {
    const config = this.configService.get('openRouter', { infer: true });
    const aiRequestId = options.context.aiRequestId ?? randomUUID();
    const { companyId, documentId, purpose } = options.context;
    const logTags = `[aiRequestId=${aiRequestId}] [documentId=${documentId ?? 'n/a'}]`;

    if (!config.apiKey) {
      throw new BadGatewayException(
        'La integración con IA no está configurada (falta OPENROUTER_API_KEY).',
      );
    }

    console.log(
      `[AI] Iniciando llamada a OpenRouter ${logTags} [purpose=${purpose}] [model=${config.model}]`,
    );

    await this.aiGenerationLogsRepository.createPending({
      aiRequestId,
      companyId,
      documentId,
      purpose,
      requestedModel: config.model,
    });

    const requestBody = {
      model: config.model,
      messages,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      // Fuerza una respuesta JSON válida en vez de confiar solo en la
      // instrucción del prompt — la mayoría de los modelos servidos por
      // OpenRouter (incluido openai/*) soportan este campo.
      response_format: { type: 'json_object' },
    };

    const startedAt = Date.now();

    try {
      const response = await firstValueFrom(
        this.httpService.post<OpenRouterCompletionResponse>(
          `${config.baseUrl}/chat/completions`,
          requestBody,
          {
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json',
              // X-Title identifica la app en el dashboard de OpenRouter (no
              // requiere una URL real, a diferencia de HTTP-Referer, que se
              // omite a propósito: no hay un dominio de producción
              // configurado en env para no inventar uno). X-Request-ID
              // queda solo para nuestros propios logs/proxies intermedios —
              // OpenRouter no expone una forma oficial de aceptar un id de
              // correlación propio (confirmado en su documentación), así
              // que no hay garantía de que lo refleje en algún campo de la
              // respuesta.
              'X-Title': 'Jarvis',
              'X-Request-ID': aiRequestId,
            },
            timeout: 30000,
            validateStatus: () => true,
          },
        ),
      );

      if (response.status < 200 || response.status >= 300) {
        this.logger.error(
          `[OpenRouter] ${logTags} POST /chat/completions respondió con estado ${response.status}: ${this.preview(
            response.data,
          )}`,
        );

        await this.aiGenerationLogsRepository.markFailed(
          aiRequestId,
          `HTTP ${response.status}`,
        );

        throw new BadGatewayException(
          'No se pudo obtener la sugerencia de IA (error de OpenRouter).',
        );
      }

      const data = response.data;
      const usage = data.usage;
      const reasoningTokens =
        usage?.completion_tokens_details?.reasoning_tokens ?? null;
      const finishReason = data.choices?.[0]?.finish_reason ?? null;

      console.log(
        `[AI] Respuesta de OpenRouter ${logTags} [generationId=${data.id ?? 'n/a'}] [model=${data.model ?? 'n/a'}] [promptTokens=${usage?.prompt_tokens ?? 'n/a'}] [completionTokens=${usage?.completion_tokens ?? 'n/a'}] [reasoningTokens=${reasoningTokens ?? 0}] [cost=${usage?.cost ?? 'n/a'}] [finishReason=${finishReason ?? 'n/a'}] [elapsedMs=${Date.now() - startedAt}]`,
      );

      await this.aiGenerationLogsRepository.markCompleted(aiRequestId, {
        responseModel: data.model ?? null,
        openRouterGenerationId: data.id ?? null,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        reasoningTokens,
        finishReason,
        totalCost: usage?.cost ?? null,
      });

      if (data.id) {
        // No bloquea al llamador: proveedor real/costo definitivo/latencia
        // solo se conocen vía esta consulta aparte (ver docstring de la
        // clase), y no son necesarios para que la clasificación funcione.
        void this.enrichGenerationStats(aiRequestId, data.id, logTags);
      }

      return {
        content: this.extractMessageContent(data),
        aiRequestId,
      };
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      this.logger.error(
        `[OpenRouter] ${logTags} Error al llamar a /chat/completions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      await this.aiGenerationLogsRepository.markFailed(
        aiRequestId,
        error instanceof Error ? error.message : String(error),
      );

      throw new BadGatewayException(
        'No se pudo obtener la sugerencia de IA. Intenta nuevamente.',
      );
    }
  }

  /** GET /api/v1/generation?id=... — forma oficial de OpenRouter para
   * conseguir proveedor real, costo definitivo y latencia de una generación
   * ya emitida (nunca vienen en la respuesta del completion). Mejor
   * esfuerzo: si falla, la auditoría se queda con lo que ya guardó
   * markCompleted (tokens/costo estimado/finishReason), nada de esto es
   * necesario para el resto del flujo. */
  private async enrichGenerationStats(
    aiRequestId: string,
    generationId: string,
    logTags: string,
  ): Promise<void> {
    const config = this.configService.get('openRouter', { infer: true });

    try {
      const response = await firstValueFrom(
        this.httpService.get<{ data?: OpenRouterGenerationStats }>(
          `${config.baseUrl}/generation`,
          {
            params: { id: generationId },
            headers: { Authorization: `Bearer ${config.apiKey}` },
            timeout: 15000,
            validateStatus: () => true,
          },
        ),
      );

      if (response.status < 200 || response.status >= 300) {
        this.logger.warn(
          `[OpenRouter] ${logTags} GET /generation respondió con estado ${response.status}, se omite el enriquecimiento.`,
        );
        return;
      }

      const stats = response.data?.data;

      if (!stats) {
        return;
      }

      console.log(
        `[AI] Detalle de generación OpenRouter ${logTags} [generationId=${generationId}] [requestId=${stats.request_id ?? 'n/a'}] [provider=${stats.provider_name ?? 'n/a'}] [cost=${stats.total_cost ?? 'n/a'}] [nativeFinishReason=${stats.native_finish_reason ?? 'n/a'}] [generationTimeMs=${stats.generation_time ?? 'n/a'}] [latencyMs=${stats.latency ?? 'n/a'}]`,
      );

      await this.aiGenerationLogsRepository.enrich(aiRequestId, {
        openRouterRequestId: stats.request_id ?? null,
        providerName: stats.provider_name ?? null,
        totalCost: stats.total_cost ?? null,
        nativeFinishReason: stats.native_finish_reason ?? null,
        generationTimeMs: stats.generation_time ?? null,
        latencyMs: stats.latency ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `[OpenRouter] ${logTags} No se pudo consultar GET /generation.`,
        error instanceof Error ? error.message : error,
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
