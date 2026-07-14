function readEnvString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
}

function assertRequiredString(
  value: string | undefined,
  fieldName: string,
): string {
  if (!value) {
    throw new Error(
      `${fieldName} es obligatoria. Configúrala en las variables de entorno del servicio.`,
    );
  }

  return value;
}

function assertValidPort(value: string | undefined): void {
  const port = Number(value ?? '3000');

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT debe ser un número entero entre 1 y 65535.');
  }
}

function assertValidTaxRate(value: string | undefined): void {
  if (!value) {
    return;
  }

  const rate = Number(value);

  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(
      'SIIGO_DEFAULT_TAX_RATE debe ser un número entre 0 y 1 (por ejemplo, 0.19 para IVA 19%).',
    );
  }
}

function assertValidImportSessionTtl(value: string | undefined): void {
  const ttl = Number(value ?? '3600');

  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error(
      'IMPORT_SESSION_TTL_SECONDS debe ser un entero mayor a cero.',
    );
  }
}

/**
 * NestJS ejecuta `validate` sobre las variables de entorno planas
 * (DATABASE_URL, JWT_ACCESS_SECRET, etc.), no sobre el objeto anidado
 * que produce `configuration.ts`.
 */
export function validateEnvironmentConfiguration(
  config: Record<string, unknown>,
): Record<string, unknown> {
  assertRequiredString(readEnvString(config, 'DATABASE_URL'), 'DATABASE_URL');
  assertRequiredString(
    readEnvString(config, 'JWT_ACCESS_SECRET'),
    'JWT_ACCESS_SECRET',
  );
  assertRequiredString(
    readEnvString(config, 'JWT_REFRESH_SECRET'),
    'JWT_REFRESH_SECRET',
  );
  assertValidPort(readEnvString(config, 'PORT'));
  assertValidTaxRate(readEnvString(config, 'SIIGO_DEFAULT_TAX_RATE'));
  assertValidImportSessionTtl(
    readEnvString(config, 'IMPORT_SESSION_TTL_SECONDS'),
  );

  return config;
}
