export interface BoldCheckoutTax {
  type: string;
  base: number;
  value: number;
}

export interface BoldCheckoutPayload {
  amount: {
    currency: string;
    taxes: BoldCheckoutTax[];
    tip_amount: number;
    total_amount: number;
  };
  payment_method: 'POS';
  terminal_model: string;
  terminal_serial: string;
  reference: string;
  user_email: string;
}

export interface BoldCheckoutResponse {
  [key: string]: unknown;
  errors?: unknown[];
}
