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

export interface DianConfig {
  cookie?: string;
}

export interface AppConfiguration {
  app: AppConfig;
  database: DatabaseConfig;
  jwt: JwtConfig;
  siigo: SiigoConfig;
  redis: RedisConfig;
  dian: DianConfig;
}

function parseBoolean(value: string | undefined, defaultValue = false): boolean {
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
  dian: {
    cookie: trimOptional(process.env.DIAN_COOKIE),
  },
});
