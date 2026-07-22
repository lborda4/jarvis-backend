import {
  SupplierCostCenterPreference,
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from './supplier-mapping-value.interface';

export interface SupplierPreferenceAccount {
  code: string;
  name: string;
}

export interface SupplierPreferenceSnapshot {
  account: SupplierPreferenceAccount;
  paymentMethod?: SupplierPaymentMethodPreference | null;
  retentions: SupplierRetentionPreference[];
  costCenter?: SupplierCostCenterPreference | null;
}
