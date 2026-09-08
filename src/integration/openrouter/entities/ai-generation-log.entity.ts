import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AiGenerationLogStatus = 'pending' | 'completed' | 'failed';

/**
 * Auditoría de cada llamada a OpenRouter — no guarda el prompt ni la
 * respuesta (ver OpenRouterHttpClient), solo IDs y metadata de costo/uso.
 * Existe para poder correlacionar un `documentId` puntual con lo que
 * realmente pasó en OpenRouter (qué proveedor respondió, cuántos tokens,
 * cuánto costó) sin depender de buscar a mano en el dashboard de OpenRouter
 * cuando hay varias llamadas parecidas — especialmente relevante con
 * `openrouter/auto`, donde el proveedor real varía por llamada.
 */
@Entity('ai_generation_logs')
@Index('IDX_ai_generation_logs_document', ['documentId'])
@Index('IDX_ai_generation_logs_company', ['companyId'])
export class AiGenerationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nuestro propio id de correlación (ver OpenRouterHttpClient) — generado
   * ANTES de llamar a OpenRouter, así aparece en los logs de "inicio" y
   * "respuesta" aunque la llamada falle antes de que OpenRouter devuelva
   * cualquier id propio. */
  @Column({ name: 'ai_request_id', type: 'uuid', unique: true })
  aiRequestId: string;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId: string | null;

  /** Qué llamador disparó esta generación (ej.
   * 'purchase-item-classification' = clasificación automática en
   * background, 'purchase-full-classification' = botón manual "Sugerir con
   * IA") — ambos pasan por el mismo OpenRouterHttpClient. */
  @Column({ type: 'varchar' })
  purpose: string;

  /** Modelo pedido en la request (ej. 'openrouter/auto') — puede diferir del
   * modelo que realmente respondió cuando se usa un router. */
  @Column({ name: 'requested_model', type: 'varchar' })
  requestedModel: string;

  @Column({ name: 'response_model', type: 'varchar', nullable: true })
  responseModel: string | null;

  /** `id` de la respuesta de /chat/completions — es el generation id que
   * después se puede consultar en GET /api/v1/generation?id=... */
  @Column({
    name: 'open_router_generation_id',
    type: 'varchar',
    nullable: true,
  })
  openRouterGenerationId: string | null;

  /** `request_id` que devuelve GET /api/v1/generation (distinto del
   * generation id) — se llena en el enriquecimiento en segundo plano. */
  @Column({ name: 'open_router_request_id', type: 'varchar', nullable: true })
  openRouterRequestId: string | null;

  /** Proveedor real que sirvió la request (ej. "OpenAI", "DeepInfra") — solo
   * se conoce vía GET /api/v1/generation, nunca en la respuesta del
   * completion en sí. Es el dato más importante para diagnosticar
   * `openrouter/auto`. */
  @Column({ name: 'provider_name', type: 'varchar', nullable: true })
  providerName: string | null;

  @Column({ name: 'prompt_tokens', type: 'integer', nullable: true })
  promptTokens: number | null;

  @Column({ name: 'completion_tokens', type: 'integer', nullable: true })
  completionTokens: number | null;

  /** Tokens gastados en razonamiento oculto antes de la respuesta visible —
   * ver usage.completion_tokens_details.reasoning_tokens de OpenRouter. Un
   * valor alto acá es la señal directa de "la IA se enredó pensando en vez
   * de responder" (caso real reportado con openrouter/auto). */
  @Column({ name: 'reasoning_tokens', type: 'integer', nullable: true })
  reasoningTokens: number | null;

  @Column({
    name: 'total_cost',
    type: 'numeric',
    precision: 12,
    scale: 6,
    nullable: true,
  })
  totalCost: number | null;

  @Column({ name: 'finish_reason', type: 'varchar', nullable: true })
  finishReason: string | null;

  @Column({ name: 'native_finish_reason', type: 'varchar', nullable: true })
  nativeFinishReason: string | null;

  @Column({ name: 'generation_time_ms', type: 'integer', nullable: true })
  generationTimeMs: number | null;

  @Column({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs: number | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: AiGenerationLogStatus;

  /** Mensaje de error sanitizado (nunca el prompt/respuesta completa) si la
   * llamada a OpenRouter falló. */
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
