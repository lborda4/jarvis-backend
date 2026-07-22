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

export interface SupplierCostCenterPreference {
  id: number;
  code: string;
  name: string;
}
