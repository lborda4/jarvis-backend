export interface SupplierAccountMapping {
  code: string;
  name: string;
  uses: number;
}

export interface SupplierPaymentMethodPreference {
  id: number;
  name: string;
  type: string;
  dueDate?: boolean;
}

export interface SupplierRetentionPreference {
  id: number;
  name: string;
  type: string;
  percentage: number;
}

export interface SupplierMappingValue {
  accounts: SupplierAccountMapping[];
  paymentMethod?: SupplierPaymentMethodPreference | null;
  retentions?: SupplierRetentionPreference[];
}
