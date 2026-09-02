export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
}

export interface DatabaseConfig {
  url: string;
  synchronize: boolean;
  migrationsRun: boolean;
}

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  accessExpiresIn: string;
  refreshExpiresIn: string;
}

export interface SiigoConfig {
  username?: string;
  accessKey?: string;
  partnerId?: string;
  defaultTaxRate?: number;
}

export interface RedisConfig {
  url?: string;
  importSessionTtlSeconds: number;
}

export interface PurchaseInvoiceImportConfig {
  /** Filas procesadas y persistidas juntas por el worker en cada pasada. */
  batchSize: number;
  /** Consultas simultáneas a NextPyme dentro de un mismo lote. */
  concurrency: number;
  /** Reintentos adicionales (además del intento original) para errores
   * clasificados como transitorios al consultar NextPyme. */
  maxRetries: number;
  /** Minutos que puede pasar una fila en 'processing' antes de
   * considerarse abandonada (worker caído a mitad de proceso) y volver a
   * 'pending'. */
  processingTimeoutMinutes: number;
  /** Cada cuánto el worker revisa si hay trabajo pendiente cuando no tiene
   * nada para procesar. */
  workerPollIntervalMs: number;
}

export interface SiigoPurchaseHistoryAutoSyncConfig {
  /** Cada cuánto el proceso en background revisa si alguna empresa tiene el
   * sync de historial de compras vencido — NO es el intervalo de refresco
   * por empresa (ver staleAfterHours), solo la frecuencia del chequeo. */
  checkIntervalMs: number;
  /** Antigüedad del último sync COMPLETADO a partir de la cual una empresa
   * se considera vencida y se vuelve a sincronizar sola, sin que nadie la
   * dispare a mano. */
  staleAfterHours: number;
  /** Pausa entre el arranque del resync de una empresa y el de la
   * siguiente — espacia el inicio (no la duración) para no lanzar varias
   * sincronizaciones completas de golpe si muchas empresas vencen a la vez. */
  startStaggerMs: number;
}

export interface NextPymeConfig {
  baseUrl: string;
  apiToken?: string;
  invoiceQueryUrl: string;
}

/** Reemplaza la integración anterior con OpenAI directo — mismo formato
 * OpenAI-compatible (chat/completions), pero a través de OpenRouter, que
 * enruta a distintos modelos con una sola API key. */
export interface OpenRouterConfig {
  apiKey?: string;
  model: string;
  baseUrl: string;
  /** Apagado global de pruebas: en `false` el cliente se comporta como si
   * no tuviera API key (isConfigured() = false), así que todos los
   * llamadores existentes ya caen solos a su fallback sin IA. */
  enabled: boolean;
}

export interface AppConfiguration {
  app: AppConfig;
  database: DatabaseConfig;
  jwt: JwtConfig;
  siigo: SiigoConfig;
  redis: RedisConfig;
  nextPyme: NextPymeConfig;
  openRouter: OpenRouterConfig;
  purchaseInvoiceImport: PurchaseInvoiceImportConfig;
  siigoPurchaseHistoryAutoSync: SiigoPurchaseHistoryAutoSyncConfig;
}

function parseBoolean(
  value: string | undefined,
  defaultValue = false,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return value.trim().toLowerCase() === 'true';
}

function parsePositiveInteger(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function parseCsvList(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default (): AppConfiguration => ({
  app: {
    nodeEnv: process.env.NODE_ENV?.trim() || 'local',
    port: parsePositiveInteger(process.env.PORT, 3000),
    corsOrigins: parseCsvList(process.env.CORS_ORIGINS),
  },
  database: {
    url: process.env.DATABASE_URL?.trim() ?? '',
    synchronize: parseBoolean(process.env.DB_SYNCHRONIZE),
    migrationsRun: parseBoolean(process.env.DB_MIGRATIONS_RUN, true),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET?.trim() ?? '',
    refreshSecret: process.env.JWT_REFRESH_SECRET?.trim() ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN?.trim() || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN?.trim() || '7d',
  },
  siigo: {
    username: trimOptional(process.env.SIIGO_USERNAME),
    accessKey: trimOptional(process.env.SIIGO_ACCESS_KEY),
    partnerId: trimOptional(process.env.SIIGO_PARTNER_ID),
    defaultTaxRate: parseOptionalNumber(process.env.SIIGO_DEFAULT_TAX_RATE),
  },
  redis: {
    url: trimOptional(process.env.REDIS_URL),
    importSessionTtlSeconds: parsePositiveInteger(
      process.env.IMPORT_SESSION_TTL_SECONDS,
      3600,
    ),
  },
  nextPyme: {
    baseUrl:
      trimOptional(process.env.NEXTPYME_BASE_URL) ??
      'https://api.nextpyme.plus/api/ubl2.1',
    apiToken: trimOptional(process.env.NEXTPYME_API_TOKEN),
    invoiceQueryUrl:
      trimOptional(process.env.NEXTPYME_INVOICE_QUERY_URL) ??
      'https://api.nextpyme.plus/api/return-invoice-data',
  },
  openRouter: {
    apiKey: trimOptional(process.env.OPENROUTER_API_KEY),
    model: trimOptional(process.env.OPENROUTER_MODEL) ?? 'openai/gpt-4o-mini',
    baseUrl:
      trimOptional(process.env.OPENROUTER_BASE_URL) ??
      'https://openrouter.ai/api/v1',
    enabled: parseBoolean(process.env.AI_CLASSIFICATION_ENABLED, true),
  },
  purchaseInvoiceImport: {
    batchSize: parsePositiveInteger(
      process.env.PURCHASE_INVOICE_IMPORT_BATCH_SIZE,
      20,
    ),
    concurrency: parsePositiveInteger(
      process.env.PURCHASE_INVOICE_IMPORT_CONCURRENCY,
      4,
    ),
    maxRetries: parsePositiveInteger(
      process.env.PURCHASE_INVOICE_IMPORT_MAX_RETRIES,
      2,
    ),
    processingTimeoutMinutes: parsePositiveInteger(
      process.env.PURCHASE_INVOICE_PROCESSING_TIMEOUT_MINUTES,
      10,
    ),
    workerPollIntervalMs: parsePositiveInteger(
      process.env.PURCHASE_INVOICE_WORKER_POLL_INTERVAL_MS,
      2000,
    ),
  },
  siigoPurchaseHistoryAutoSync: {
    checkIntervalMs: parsePositiveInteger(
      process.env.SIIGO_PURCHASE_HISTORY_AUTO_SYNC_CHECK_INTERVAL_MS,
      24 * 60 * 60 * 1000, // 24h
    ),
    staleAfterHours: parsePositiveInteger(
      process.env.SIIGO_PURCHASE_HISTORY_AUTO_SYNC_STALE_AFTER_HOURS,
      12,
    ),
    startStaggerMs: parsePositiveInteger(
      process.env.SIIGO_PURCHASE_HISTORY_AUTO_SYNC_START_STAGGER_MS,
      15_000,
    ),
  },
});
