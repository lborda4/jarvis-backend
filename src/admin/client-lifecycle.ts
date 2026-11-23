import type { DataSource } from 'typeorm';
import type { Company } from '../company/entities/company.entity';
import { DEFAULT_JARVIS_MODULES } from '../company/jarvis-modules';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { SiigoAccount } from '../integration/entities/siigo-account.entity';
import { areJarvisCredentialsConfigured, isJarvisResolutionConfigured, normalizeJarvisCredentials } from '../integration/jarvis/helpers/jarvis-credentials.helper';
import { areSiigoCredentialsConfigured, areSiigoDocumentTypesConfigured } from '../integration/siigo/helpers/siigo-credentials.helper';

export type ClientLifecycleStatus = 'VERIFY_PAYMENT' | 'PAID' | 'ACTIVE';

/** Commercial onboarding, independent of expiry/access and later recharge invoices. Read only persisted setup. */
export async function clientLifecycleStatus(company: Company, db: DataSource): Promise<ClientLifecycleStatus | null> {
  // Preserve the existing management of clients not created/assigned through the advisor channel.
  if (!company.advisorId) return null;
  if (!(company.commercialActivity ?? []).some(item => item.kind === 'PAYMENT')) return 'VERIFY_PAYMENT';
  const integrations = (company.integrations ?? []).filter(item => item.active && [IntegrationProvider.JARVIS, IntegrationProvider.SIIGO].includes(item.provider));
  if (!integrations.length) return 'PAID';
  for (const integration of integrations) {
    if (integration.provider === IntegrationProvider.JARVIS) {
      if (!areJarvisCredentialsConfigured(integration.credentials ?? {})) return 'PAID';
      if ((company.jarvisModules ?? DEFAULT_JARVIS_MODULES).includes('BILLING')) {
        const credentials = normalizeJarvisCredentials(integration.credentials);
        if (!isJarvisResolutionConfigured(credentials.resolutions?.support_document) && !isJarvisResolutionConfigured(credentials.resolutions?.electronic_invoice)) return 'PAID';
      }
    } else {
      const included = integration.includedDocumentTypes?.length ? integration.includedDocumentTypes : integration.plan?.includedDocumentTypes ?? [];
      if (!areSiigoCredentialsConfigured(integration.credentials ?? {}) || !integration.accountsExcelImportedAt || !areSiigoDocumentTypesConfigured(integration.credentials, included)) return 'PAID';
      const accounts = await db.getRepository(SiigoAccount).count({ where: { companyId: company.id, integrationId: integration.id } });
      if (!accounts) return 'PAID';
    }
  }
  return 'ACTIVE';
}
