export interface BoldCheckoutPayload {
  amount: {
    currency: string;
    total: number;
    taxes: Record<string, unknown>[];
    tip: number;
  };
  user_email: string;
  payment_method: 'POS';
  terminal_model: string;
  terminal_serial: string;
  reference: string;
}

export interface BoldCheckoutResponse {
  [key: string]: unknown;
  errors?: unknown[];
}
