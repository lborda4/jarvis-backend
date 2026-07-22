import {
  IntegrationCredentials,
  JarvisCredentials,
} from '../../interfaces/integration-credentials.interface';
import { JarvisEntityType } from '../enums/jarvis-entity-type.enum';
import { JarvisTaxRegime } from '../enums/jarvis-tax-regime.enum';

const JARVIS_ENTITY_TYPES = new Set<string>(Object.values(JarvisEntityType));
const JARVIS_TAX_REGIMES = new Set<string>(Object.values(JarvisTaxRegime));

export function normalizeJarvisCredentials(
  credentials: IntegrationCredentials,
): JarvisCredentials {
  const raw = credentials as unknown as Record<string, unknown>;

  const entityType = String(raw.entity_type ?? raw.entityType ?? '').trim();
  const taxRegime = String(raw.tax_regime ?? raw.taxRegime ?? '').trim();

  return {
    business_name: String(raw.business_name ?? raw.businessName ?? '').trim(),
    economic_activity: String(
      raw.economic_activity ?? raw.economicActivity ?? '',
    ).trim(),
    entity_type: JARVIS_ENTITY_TYPES.has(entityType)
      ? (entityType as JarvisEntityType)
      : undefined,
    tax_regime: JARVIS_TAX_REGIMES.has(taxRegime)
      ? (taxRegime as JarvisTaxRegime)
      : undefined,
    configured_at: raw.configured_at
      ? String(raw.configured_at)
      : raw.configuredAt
        ? String(raw.configuredAt)
        : undefined,
  };
}

export function areJarvisCredentialsConfigured(
  credentials: IntegrationCredentials,
): boolean {
  const normalized = normalizeJarvisCredentials(credentials);

  return Boolean(
    normalized.business_name &&
      normalized.economic_activity &&
      normalized.entity_type &&
      normalized.tax_regime,
  );
}
