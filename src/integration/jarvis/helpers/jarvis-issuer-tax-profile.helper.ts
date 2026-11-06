import type { JarvisCredentials } from '../../interfaces/integration-credentials.interface';

export interface JarvisIssuerTaxProfile {
  vatRegime?: string;
  economicActivity?: string;
  taxResponsibility?: string;
  source: 'emission' | 'current';
}

export function issuerTaxProfile(credentials: JarvisCredentials, source: JarvisIssuerTaxProfile['source']): JarvisIssuerTaxProfile | undefined {
  if (!credentials.vat_regime && !credentials.economic_activity?.trim() && !credentials.tax_responsibility) return undefined;
  return {
    vatRegime: credentials.vat_regime,
    economicActivity: credentials.economic_activity?.trim() || undefined,
    taxResponsibility: credentials.tax_responsibility,
    source,
  };
}
