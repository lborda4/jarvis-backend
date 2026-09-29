import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiGenerationLog } from '../entities/ai-generation-log.entity';
import { ElectronicDocument } from '../../../electronic-document/entities/electronic-document.entity';
import { addAiRequestCost } from '../../../electronic-document/helpers/electronic-document-ai-cost.helper';

export interface CreatePendingAiGenerationLogInput {
  aiRequestId: string;
  companyId?: string | null;
  documentId?: string | null;
  purpose: string;
  requestedModel: string;
}

export interface CompleteAiGenerationLogInput {
  responseModel?: string | null;
  openRouterGenerationId?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  reasoningTokens?: number | null;
  finishReason?: string | null;
  totalCost?: number | null;
}

export interface EnrichAiGenerationLogInput {
  openRouterRequestId?: string | null;
  providerName?: string | null;
  totalCost?: number | null;
  nativeFinishReason?: string | null;
  generationTimeMs?: number | null;
  latencyMs?: number | null;
}

/**
 * Todos los métodos son "mejor esfuerzo" (nunca lanzan) — un fallo guardando
 * la auditoría de una llamada a OpenRouter no debe romper la clasificación
 * real, que ya tuvo su respuesta antes de que esto se llame. Ver
 * OpenRouterHttpClient, único consumidor.
 */
@Injectable()
export class AiGenerationLogsRepository {
  private readonly logger = new Logger(AiGenerationLogsRepository.name);

  constructor(
    @InjectRepository(AiGenerationLog)
    private readonly repository: Repository<AiGenerationLog>,
  ) {}

  async createPending(input: CreatePendingAiGenerationLogInput): Promise<void> {
    try {
      await this.repository.insert({
        aiRequestId: input.aiRequestId,
        companyId: input.companyId ?? null,
        documentId: input.documentId ?? null,
        purpose: input.purpose,
        requestedModel: input.requestedModel,
        status: 'pending',
      });
    } catch (error) {
      this.logger.warn(
        `[aiRequestId=${input.aiRequestId}] No se pudo registrar el inicio de la llamada a OpenRouter.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  async markCompleted(
    aiRequestId: string,
    input: CompleteAiGenerationLogInput,
  ): Promise<void> {
    try {
      await this.repository.update(
        { aiRequestId },
        {
          status: 'completed',
          responseModel: input.responseModel ?? null,
          openRouterGenerationId: input.openRouterGenerationId ?? null,
          promptTokens: input.promptTokens ?? null,
          completionTokens: input.completionTokens ?? null,
          reasoningTokens: input.reasoningTokens ?? null,
          finishReason: input.finishReason ?? null,
          completedAt: new Date(),
        },
      );
      await this.recordCost(aiRequestId, input.totalCost);
    } catch (error) {
      this.logger.warn(
        `[aiRequestId=${aiRequestId}] No se pudo registrar la respuesta de OpenRouter.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  async markFailed(aiRequestId: string, errorMessage: string): Promise<void> {
    try {
      await this.repository.update(
        { aiRequestId },
        {
          status: 'failed',
          errorMessage,
          completedAt: new Date(),
        },
      );
    } catch (error) {
      this.logger.warn(
        `[aiRequestId=${aiRequestId}] No se pudo registrar el error de OpenRouter.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** El costo vive en el documento; la tabla conserva solo la trazabilidad. */
  async recordCost(aiRequestId: string, cost?: number | null): Promise<void> {
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return;
    try {
      const log = await this.repository.findOne({ where: { aiRequestId } });
      if (!log?.documentId || !log.companyId) return;
      await this.repository.manager.transaction(async (manager) => {
        const documents = manager.getRepository(ElectronicDocument);
        const document = await documents.findOne({
          where: { id: log.documentId!, companyId: log.companyId! },
          lock: { mode: 'pessimistic_write' },
        });
        if (!document) return;
        document.payload.aiSuggestion = addAiRequestCost(
          document.payload.aiSuggestion, aiRequestId, cost,
        );
        await documents.update(document.id, { payload: document.payload });
      });
    } catch (error) {
      this.logger.warn(
        `[aiRequestId=${aiRequestId}] No se pudo guardar el costo de IA en el documento.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** Enriquecimiento en segundo plano vía GET /api/v1/generation — ver
   * OpenRouterHttpClient.fetchGenerationStats. Se aplica aparte de
   * markCompleted porque estos datos (proveedor real, costo definitivo)
   * solo están disponibles DESPUÉS del completion, nunca en la respuesta
   * original. */
  async enrich(
    aiRequestId: string,
    input: EnrichAiGenerationLogInput,
  ): Promise<void> {
    try {
      await this.repository.update(
        { aiRequestId },
        {
          openRouterRequestId: input.openRouterRequestId ?? null,
          providerName: input.providerName ?? null,
          nativeFinishReason: input.nativeFinishReason ?? null,
          generationTimeMs: input.generationTimeMs ?? null,
          latencyMs: input.latencyMs ?? null,
        },
      );
      await this.recordCost(aiRequestId, input.totalCost);
    } catch (error) {
      this.logger.warn(
        `[aiRequestId=${aiRequestId}] No se pudo enriquecer con GET /generation.`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
