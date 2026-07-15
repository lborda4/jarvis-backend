import {
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from './supplier-mapping-value.interface';

export interface SupplierPreferenceAccount {
  code: string;
  name: string;
}

export interface SupplierPreferenceSnapshot {
  account: SupplierPreferenceAccount;
  paymentMethod: SupplierPaymentMethodPreference;
  retentions: SupplierRetentionPreference[];
}
