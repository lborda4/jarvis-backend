import { AppConfiguration } from './configuration';

function assertRequiredString(
  value: string | undefined,
  fieldName: string,
): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`${fieldName} es obligatoria. Configúrala en el archivo .env del entorno activo.`);
  }

  return trimmed;
}

function assertValidPort(port: number): void {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT debe ser un número entero entre 1 y 65535.');
  }
}

function assertValidTaxRate(rate: number | undefined): void {
  if (rate === undefined) {
    return;
  }

  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(
      'SIIGO_DEFAULT_TAX_RATE debe ser un número entre 0 y 1 (por ejemplo, 0.19 para IVA 19%).',
    );
  }
}

export function validateEnvironmentConfiguration(
  config: AppConfiguration,
): AppConfiguration {
  assertRequiredString(config.database.url, 'DATABASE_URL');
  assertRequiredString(config.jwt.accessSecret, 'JWT_ACCESS_SECRET');
  assertRequiredString(config.jwt.refreshSecret, 'JWT_REFRESH_SECRET');
  assertValidPort(config.app.port);
  assertValidTaxRate(config.siigo.defaultTaxRate);

  if (
    !Number.isInteger(config.redis.importSessionTtlSeconds) ||
    config.redis.importSessionTtlSeconds <= 0
  ) {
    throw new Error(
      'IMPORT_SESSION_TTL_SECONDS debe ser un entero mayor a cero.',
    );
  }

  return config;
}
