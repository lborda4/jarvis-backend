import {
  IntegrationCredentials,
  SiigoCredentials,
} from '../../interfaces/integration-credentials.interface';

export function normalizeSiigoCredentials(
  credentials: IntegrationCredentials,
): SiigoCredentials {
  const raw = credentials as unknown as Record<string, unknown>;

  return {
    username: String(raw.username ?? ''),
    access_key: String(raw.access_key ?? raw.accessKey ?? ''),
    partner_id: raw.partner_id
      ? String(raw.partner_id)
      : raw.partnerId
        ? String(raw.partnerId)
        : undefined,
    token: raw.token
      ? String(raw.token)
      : raw.accessToken
        ? String(raw.accessToken)
        : undefined,
    expires_at: raw.expires_at
      ? String(raw.expires_at)
      : raw.expiresAt
        ? String(raw.expiresAt)
        : undefined,
  };
}

export interface SiigoEnvCredentials {
  username?: string;
  accessKey?: string;
  partnerId?: string;
}

export function resolveSiigoCredentials(
  credentials: SiigoCredentials,
  envDefaults: SiigoEnvCredentials = {},
): SiigoCredentials {
  const username = credentials.username || envDefaults.username;
  const access_key = credentials.access_key || envDefaults.accessKey;
  const partner_id = credentials.partner_id || envDefaults.partnerId || undefined;

  if (!username || !access_key) {
    throw new Error(
      'Faltan credenciales SIIGO. Configure username y access_key en Integration o en variables de entorno.',
    );
  }

  return {
    ...credentials,
    username,
    access_key,
    partner_id,
  };
}
