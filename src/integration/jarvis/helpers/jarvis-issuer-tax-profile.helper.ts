import type { JarvisCredentials } from '../../interfaces/integration-credentials.interface';

export interface JarvisIssuerTaxProfile {
  icaRate?: number;
  vatRegime?: string;
  economicActivity?: string;
  taxResponsibility?: string;
  source: 'emission' | 'current';
}

export function issuerTaxProfile(credentials: JarvisCredentials, source: JarvisIssuerTaxProfile['source']): JarvisIssuerTaxProfile | undefined {
  if (!credentials.vat_regime && !credentials.economic_activity?.trim() && !credentials.tax_responsibility && !credentials.ica_rate) return undefined;
  return {
    icaRate: credentials.ica_rate ?? 0,
    vatRegime: credentials.vat_regime,
    economicActivity: credentials.economic_activity?.trim() || undefined,
    taxResponsibility: credentials.tax_responsibility,
    source,
  };
}
