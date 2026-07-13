export const AUTH_PUBLIC_KEY = 'auth:isPublic';

export function getJwtAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET?.trim();

  if (!secret) {
    throw new Error(
      'JWT_ACCESS_SECRET no está definida. Configúrala en tu archivo .env',
    );
  }

  return secret;
}

export function getJwtRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET?.trim();

  if (!secret) {
    throw new Error(
      'JWT_REFRESH_SECRET no está definida. Configúrala en tu archivo .env',
    );
  }

  return secret;
}

export function getJwtAccessExpiresIn(): string {
  return process.env.JWT_ACCESS_EXPIRES_IN?.trim() || '15m';
}

export function getJwtRefreshExpiresIn(): string {
  return process.env.JWT_REFRESH_EXPIRES_IN?.trim() || '7d';
}
